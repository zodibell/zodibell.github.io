require 'yaml'
require 'fileutils'
require 'date'

TAGS_DIR = 'tags'

# -----------------------------
# 1. Collect tags from posts
# -----------------------------
posts = Dir.glob('_posts/**/*.{md,markdown}').select { |f| File.file?(f) }
post_tags = Hash.new(0)

posts.each do |post_path|
  content = File.read(post_path)
  if content =~ /\A---(.+?)---/m
    front_matter = YAML.safe_load($1, permitted_classes: [Date])
    Array(front_matter['tags']).each { |tag| post_tags[tag] += 1 }
  end
end

# -----------------------------
# 2. Collect tags from vocabulary
# -----------------------------
vocab_file = File.join('_data', 'vocabulary.yml')
vocab_tags = Hash.new(0)

if File.exist?(vocab_file)
  vocab_data = YAML.load_file(vocab_file)
  vocab_data.each do |entry|
    Array(entry['tags']).each { |tag| vocab_tags[tag] += 1 }
  end
end

# -----------------------------
# 3. Merge tags and counts
# -----------------------------
all_tags = post_tags.merge(vocab_tags) { |tag, post_count, vocab_count| post_count + vocab_count }

# Sort tags alphabetically
sorted_tags = all_tags.keys.sort_by(&:downcase)

puts "Found tags: #{sorted_tags.join(', ')}"

# -----------------------------
# 4. Generate tag pages
# -----------------------------
sorted_tags.each do |tag|
  clean_tag = tag.downcase.strip.gsub(/^tags[-\/]/, '') # remove 'tags-' or 'tags/' prefix
  slug = clean_tag.gsub(' ', '-').gsub(/[^\w-]/, '')

  tag_folder = File.join(TAGS_DIR, slug)
  FileUtils.mkdir_p(tag_folder)

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

  puts "Generated page for tag: #{tag} -> /tags/#{slug}/index.md (#{all_tags[tag]} items)"
end
