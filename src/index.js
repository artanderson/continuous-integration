const core = require('@actions/core');
const github = require('@actions/github');

const sleep = (seconds) => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

const main = async () => {
    try{
        const token = core.getInput('gh_token', {required: true});
        const excludedLabels = core.getInput('labels', {required: true});
        const seconds = core.getInput('seconds', {required: true});
        const oktokit = github.getOctokit(token);
        const { owner, repo } = github.context.repo;
        const branch = "prod-staging";

        let pulls = await oktokit.rest.pulls.list({
            owner,
            repo,
            state: "open",
            base: "main",
            per_page: 100
        })

        let pullNums = [];
        pulls.map(pull => {
            pullNums.push(pull.number);       
        })

        for(let pull of pullNums){
            let complete = false;
            let labels = true;
            let pr = await oktokit.rest.pulls.get({
                owner,
                repo,
                pull_number: pull
            });
            if(pr.mergeable === null){
                await sleep(30);
                pr = await oktokit.rest.pulls.get({
                    owner,
                    repo,
                    pull_number: pull
                });
            }
            for(let label of labels){
                if(excludedLabels.includes(label.name)){
                    labels = false;
                    break;
                }
            }
            if(pr.mergeable && labels){
                await oktokit.rest.pulls.update({
                    owner,
                    repo,
                    pull_number: pull,
                    base: branch
                })
                .then(() => {
                    while(!complete){
                        try{
                            let updatedPr = await oktokit.rest.pulls.get({
                                owner,
                                repo,
                                pull_number: pull
                            });
                            if(updatedPr.mergeable){
                                complete = true;
                                await oktokit.rest.pulls.merge({
                                    owner,
                                    repo,
                                    pull_number: pull
                                });
                            }
                            else{
                                await sleep(seconds);
                            }
                        }
                        catch{
                            core.setFailed(error.message);        
                        }
                    }
                })
                .catch(() => {
                    core.setFailed(error.message);
                });
            }
        }        
    }
    catch{
        core.setFailed(error.message);
    }
}
main();