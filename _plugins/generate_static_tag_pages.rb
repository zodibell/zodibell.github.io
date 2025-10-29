# frozen_string_literal: true

require 'fileutils'
require 'yaml'

# Configuration
SOURCE_DATA = '_data/vocabulary.yml'
POSTS_DIR = '_posts'
OUTPUT_DIR = 'tags'
LAYOUT = 'tag'

# Collect tags from vocabulary data
vocab_tags = []
if File.exist?(SOURCE_DATA)
  vocab_data = YAML.load_file(SOURCE_DATA)
  vocab_data.each do |entry|
    tags = entry['tags']
    vocab_tags.concat(tags) if tags.is_a?(Array)
  end
end

# Collect tags from posts
post_tags = []
Dir.glob("#{POSTS_DIR}/**/*.md").each do |file|
  front_matter = File.read(file).split(/^---\s*$|^\.\.\.\s*$/)[1]
  if front_matter
 data = YAML.safe_load(front_matter, permitted_classes: [Date])
    tags = data['tags']
    post_tags.concat(tags) if tags.is_a?(Array)
  end
end

# Combine and deduplicate
all_tags = (vocab_tags + post_tags).compact.uniq.sort

# Generate tag pages
all_tags.each do |tag|
  slug = tag.downcase.strip.gsub(' ', '-').gsub(/[^\w-]/, '')
  dir = File.join(OUTPUT_DIR, slug)
  path = File.join(dir, 'index.md')

  FileUtils.mkdir_p(dir)

  File.write(path, <<~MARKDOWN)
    ---
    layout: #{LAYOUT}
    title: Posts tagged "#{tag}"
    tag: #{tag.downcase}
    permalink: /tags/#{slug}/
    ---
  MARKDOWN

  puts "✅ Created: #{path}"
end