require 'safe_yaml'
require 'uri'
require 'octokit'
require 'open-uri'
require 'zlib'
require 'rubygems/package'

def valid_url? (url)
    begin
     uri = URI.parse(url)
     uri.kind_of?(URI::HTTP) || uri.kind_of?(URI::HTTPS)
   rescue URI::InvalidURIError
     false
   end
end

def try_read_owner_repo (url)
    # path semgent in Ruby looks like /{owner}/repo so we drop the
    # first array value (which should be an empty string) and then
    # combine the next two elements

    pathSegments = url.path.split('/')

    if pathSegments.length < 3 then
        # this likely means the URL points to a filtered search URL
        return nil
    else
        values = pathSegments.drop(1).take(2)

        if  values[0].casecmp("orgs") == 0 then
            # points to a project board for the organization
            return nil
        end

        return values.join('/')
    end
end

def find_github_url (url)
    if !valid_url?(url) then
      return nil
    end

    uri = URI.parse(url)

    if uri.host.casecmp("github.com") != 0 then
        return nil
    else
        return try_read_owner_repo(uri)
    end
end

def find_owner_repo_pair (yaml)
    site = yaml["site"]
    owner_and_repo = find_github_url(site)

    if owner_and_repo then
        return owner_and_repo
    end

    upforgrabs = yaml["upforgrabs"]["link"]
    owner_and_repo = find_github_url(upforgrabs)
    if owner_and_repo then
        return owner_and_repo
    end

    return nil
end

def check_rate_limit (client)
  rate_limit = client.rate_limit

  remaining = rate_limit.remaining
  resets_in = rate_limit.resets_in
  limit = rate_limit.limit

  puts "Rate limit: #{remaining}/#{limit} - #{resets_in}s before reset"

  if (remaining == 0) then
    puts "Sleeping for #{resets_in} to wait for rate-limiting to reset"
    sleep resets_in
  end

end

def verify_file (client, path, contents)
    begin
      yaml = YAML.load(contents, :safe => true)

      ownerAndRepo = find_owner_repo_pair(yaml)

      if ownerAndRepo == nil then
        # ignoring entry as we could not find a valid GitHub URL
        # this likely means it's hosted elsewhere
        return { :path => path, :error => nil}
      end

      check_rate_limit(client)

      repo = client.repo ownerAndRepo

      archived = repo.archived

      if archived then
        error = "Repository has been marked as archived through the GitHub API"
        return { :path => path, :error => error, :deprecated => true }
      end

    rescue Psych::SyntaxError => e
      error = "Unable to parse the contents of file - Line: #{e.line}, Offset: #{e.offset}, Problem: #{e.problem}"
      return { :path => path, :error => error, :deprecated => false }
    rescue Octokit::NotFound
        error = "The repository no longer exists on the GitHub API"
        return  { :path => path, :error => error, :deprecated => true }
    rescue
      error = "Unknown exception for file: " + $!.to_s
      return  { :path => path, :error => error, :deprecated => false }
    end

  return  { :path => path, :error => nil, :deprecated => false }
end

repo = ENV['GITHUB_REPOSITORY']

puts "Inspecting repository files for #{repo}"

start = Time.now

client = Octokit::Client.new(:access_token => ENV['GITHUB_TOKEN'])

check_rate_limit(client)

link = client.archive_link(repo)

pattern = Regexp.new('.*\/(_data\/projects\/.*.yml)')

errors = 0
success = 0

open(link) do |archive|
  tar_extract = Gem::Package::TarReader.new(Zlib::GzipReader.open(archive))
  tar_extract.rewind # The extract has to be rewinded after every iteration
  tar_extract.each do |entry|
    if (entry.file? && pattern.match?(entry.full_name)) then

      matches = pattern.match(entry.full_name).captures
      file_path = matches[0]
      contents = entry.read

      result = verify_file(client, file_path, contents)

      if (result[:deprecated]) then
        puts "Project is considered deprecated: '#{file_path}'"
        puts ''
        puts "TODO: check for open pull request that removes file '#{file_path}'"
        puts ''
        errors += 1
      elsif (result[:error] != nil)
        puts "Encountered error while trying to validate '#{file_path}' - #{result[:error]}"
        errors += 1
      else
        puts "Project is active: '#{file_path}'"
        success += 1
      end
    end
  end
  tar_extract.close
end

finish = Time.now
delta = finish - start

puts "Operation took #{delta}s"
puts ''
puts "#{success} files processed - #{errors} errors found"

if (errors > 0) then
  exit -1
else
  exit 78
end


