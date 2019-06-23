workflow "Clean stale projects" {
  on = "push"
  resolves = ["Cleanup archived projects"]
}

action "Default Branch" {
  uses = "actions/bin/filter@master"
  args = "branch gh-pages"
}

action "Cleanup archived projects" {
  needs = "Default Branch"
  uses = "./.github/actions/cleanup-archived-projects"
  secrets = ["GITHUB_TOKEN"]
}
