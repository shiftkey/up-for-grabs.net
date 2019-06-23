workflow "Clean stale projects" {
  on = "push"
  resolves = ["Cleanup archived projects"]
}

action "Cleanup archived projects" {
  uses = "./.github/actions/cleanup-archived-projects"
  secrets = ["GITHUB_TOKEN"]
}
