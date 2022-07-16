const core = require('@actions/core');
const github = require('@actions/github');

const sleep = (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

const main = async () => {
    try{
        const token = core.getInput('gh_token', {required: true});
        const branch = core.getInput('branch', {required: true});
        const seconds = core.getInput('interval', {required: true});
        const excludedLabels = core.getInput('labels', {required: false});
        let readyPrs = 0;
        
        const octokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;
        
        let exLabels = excludedLabels.toLowerCase().split('_');

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

        let pullNums = [];
        for(let pull of pulls){
            pullNums.push(pull.number);       
        }

        if(pullNums.length === 0){
            console.log('No PRs ready to merge');
            return 0;
        }

        pulls:
        for(let pull_number of pullNums){
            let { data: pr } = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number
            });
            
            if(pr.mergeable_state !== 'clean'){
                console.log('PR not ready to merge');
                continue;
            }
            else{
                let labels = true;
                label:
                for(let label of pr.labels){
                    if(exLabels.includes(label.name.toLowerCase())){
                        labels = false;
                        break label;
                    }
                }
                if(!labels){
                    console.log('PR not ready to merge');
                    continue;
                }
            }

            await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number,
                base: branch
            })
            .then(async (response) => {
                console.log('Base branch changed to ' + branch);
                let { data: checks } = await octokit.rest.checks.listForRef({
                    owner,
                    repo,
                    ref: response.data.head.ref
                })
                console.log(checks);
                let check_run_id = 1;
                let complete = false
                while(!complete){
                    console.log("Waiting for check to complete");
                    let { data: checkRun } = await octokit.rest.checks.get({
                        owner,
                        repo,
                        check_run_id
                    })
                    if(checkRun.status !== 'complete'){
                        await sleep(seconds);
                    }
                    else{
                        if(checkRun.conclusion !== 'success'){
                            console.log("Check unsuccessful");
                            await octokit.rest.pulls.update({
                                owner,
                                repo,
                                pull_number,
                                base: "main"
                            })
                            .then(async () => {
                                console.log("Base branch updated to main");
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
                        }
                        else{
                            await octokit.rest.pulls.merge({
                                owner,
                                repo,
                                pull_number
                            })
                            .then(() => {
                                console.log("PR successfully merged into " + branch);
                                readyPrs++;
                            })
                        }
                    }
                }
            })
            .catch((error) => {
                core.setFailed(error.message);
            });
        }
        if(readyPrs === 0){
            console.log('No PRs ready to merge');
            return 0;
        }
        else{
            await octokit.rest.pulls.create({
                owner,
                repo,
                head: branch,
                base: "main"
            })
            .then(() => {
                console.log('PR created on Main');
                return 0;
            });
        }                
    }
    catch(error){
        core.setFailed(error.message);
    }
}
main();