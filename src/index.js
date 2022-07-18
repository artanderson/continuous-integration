const core = require('@actions/core');
const github = require('@actions/github');

const sleep = (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

const revert = async (octokit, owner, repo, pull_number) => {
    await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number,
        base: "main"
    })
    .then(async () => {
        console.log('Base branch set back to main');
        let { data: reviews } = await octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number
        })
        for(let review of reviews){
            await octokit.rest.pulls.dismissReview({
                owner,
                repo,
                pull_number,
                review_id: review.id,
                message: "Staging checks failed"
            })
        }
        console.log("All reviews dismissed");
    })
    .catch((error) => {
        console.log(error.message);
    })
}

const main = async () => {
    try{
        const token = core.getInput('gh_token', {required: true});
        const branch = core.getInput('branch', {required: true});
        const exLabels = ['push to public', ...core.getInput('labels', {required: false}).toLowerCase().split('_')];
        let pushToPublic = true;

        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;

        await octokit.request('POST /repos/{owner}/{repo}/merges', {
            owner,
            repo,
            base: branch,
            head: 'main',
            commit_message: "Sync staging with main"
        })
        .then(() => {
            console.log('Staging synced with main');
        })
        .catch((error) => {
            core.setFailed(error.message);
        });

        let { data: pulls } = await octokit.rest.pulls.list({
            owner,
            repo,
            state: "open",
            base: "main",
            per_page: 100
        })

        let readyPulls = [];
        for(let pull of pulls){
            let { data: pullData } = await octokit.rest.pulls.get({
                repo,
                owner,
                pull_number: pull.number
            })

            let ready = true;
            if(pullData.labels){
                labels:
                for(let label of pullData.labels){
                    if(exLabels.includes(label.name.toLowerCase())){
                        ready = false;
                        break labels;
                    }
                }
            }

            if(pullData.head.ref === branch){
                pushToPublic = false;
            }

            if(pullData.mergeable_state === 'clean' && ready){
                readyPulls.push(pullData);
            }
        }

        if(readyPulls.length === 0){
            console.log('No PRs ready to merge');
            return 0;
        }

        pulls:
        for(let pull of readyPulls){
            let pull_number = pull.number;
            let { data: response } = await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number,
                base: branch
            })
            console.log('Base branch changed to ' + branch + '\nChecking mergability...');
            await sleep(30);
            
            let { data: data } = await octokit.rest.pulls.get({
                repo,
                owner,
                pull_number
            })
            if(!data.mergeable){
                console.log("Conflicts with staging, reverting back main");
                await revert(octokit, owner, repo, pull_number);  
                continue pulls;
            } 

            console.log('Mergeability okay, waiting for check to start');
            await sleep(30);
            let { data: checks } = await octokit.rest.checks.listForRef({
                owner,
                repo,
                ref: response.data.head.ref
            })
            let check = checks.check_runs.filter((check) => check.status !== 'completed');
            let check_run_id = check[0].id;
            let complete = false
            while(!complete){
                console.log("Waiting for check to complete");
                let { data: checkRun } = await octokit.rest.checks.get({
                    owner,
                    repo,
                    check_run_id
                })
                if(checkRun.status !== 'completed'){
                    await sleep(30);
                }
                else{
                    complete = true;
                    if(checkRun.conclusion !== 'success'){
                        console.log("Check unsuccessful");
                        revert(octokit, owner, repo, pull_number);
                    }
                    else{
                        await octokit.rest.pulls.merge({
                            owner,
                            repo,
                            pull_number
                        })
                        .then(() => {
                            console.log("PR successfully merged into " + branch);
                        })
                        .catch((error) => {
                            console.log(error.message);
                            revert(octokit, owner, repo, pull_number);
                        })
                    }
                }
            }
        }

        if(pushToPublic){
            await octokit.rest.pulls.create({
                owner,
                repo,
                head: branch,
                base: "main",
                title: "Push to public site"
            })
            .then(async (response) => {
                if (response.status === 201){
                    await octokit.rest.issues.addLabels({
                        owner,
                        repo,
                        issue_number: response.data.number,
                        labels: ['push to public']
                    })
                    .then(() => {
                        console.log('PR created on Main');
                        return 0;
                    })
                }
                else{
                    console.log('Create pull request to main failed');
                }
            });
        }
        else{            
            console.log('Push to public pull request already exists')
        }                
    }
    catch(error){
        core.setFailed(error.message);
    }
}
main();