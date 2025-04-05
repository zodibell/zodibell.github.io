require 'yaml'
require 'fileutils'
require 'date'

# Directory where tag pages will be created
TAGS_DIR = 'tags'

# Read all posts
posts = Dir.glob('_posts/**/*.{md,markdown}').select { |f| File.file?(f) }

# Extract tags from the front matter of each post
all_tags = posts.flat_map do |post_path|
  content = File.read(post_path)
  if content =~ /\A---(.+?)---/m
    front_matter = YAML.safe_load($1, permitted_classes: [Date])
    front_matter['tags'] || []
  else
    []
  end
end.uniq

puts "Found tags: #{all_tags.join(', ')}"

# Create a folder and index.md for each tag
all_tags.each do |tag|
  # Normalize tag to lowercase and remove any non-alphanumeric characters, keeping hyphens
  slug = tag.downcase.strip.gsub(' ', '-').gsub(/[^\w-]/, '')

  # Create the tag folder
  tag_folder = File.join(TAGS_DIR, slug)
  FileUtils.mkdir_p(tag_folder)

  # Create the index.md file for the tag
  File.open(File.join(tag_folder, 'index.md'), 'w') do |file|
    file.puts <<~MARKDOWN
      ---
      layout: tag
      tag: #{tag}
      title: Posts tagged "#{tag}"
      permalink: /tags/#{slug}/
      ---
    MARKDOWN
  end

  puts "Generated page for tag: #{tag} -> /tags/#{slug}/index.md"
end
