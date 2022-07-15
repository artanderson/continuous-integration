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

        let pullRequests = [];
        for(let pull of pulls){
            pullRequests.push({pull_number: pull.number, sha: pull.head.sha});       
        }

        if(pullRequests.length === 0){
            console.log('No PRs ready to merge');
            return 0;
        }

        let { data: br } = await octokit.rest.repos.getBranch({
            owner,
            repo,
            branch: 'main'
        });
        console.log(br.protection.required_status_checks.contexts);
        console.log(br.protection.required_status_checks.checks);

        pulls:
        for(let pull of pullRequests){
            let { data: status } = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: pull.pull_number
            });
            console.log(status);
            

            /*if(pr.mergeable === null){
                await sleep(60);
                let { data: prRecheck } = await octokit.rest.pulls.get({
                    owner,
                    repo,
                    pull_number
                });
                pr = prRecheck;
            }
            if(!pr.mergeable){
                console.log('PR not ready to merge');
                break;
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
                    break pulls;
                }
            }
            
            await octokit.rest.pulls.update({
                owner,
                repo,
                pull_number,
                base: branch
            })
            .then(async () => {
                let { data: runs } = await octokit.rest.checks.listForRef({
                    owner,
                    repo,
                    ref: branch,
                    check_name: "checks"
                })
                let check_run_id = runs.check_runs[0].id;
                let complete = false
                while(!complete){
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
                            await octokit.rest.pulls.update({
                                owner,
                                repo,
                                pull_number,
                                base: "main"
                            })
                            .then(async () => {
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
                            })
                        }
                        else{
                            await octokit.rest.pulls.merge({
                                owner,
                                repo,
                                pull_number
                            })
                            .then(() => {
                                readyPrs++;
                            })
                        }
                    }
                }
            })
            .catch((error) => {
                core.setFailed(error.message);
            });*/
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