# _plugins/generate_tags.rb
require 'fileutils'
require 'yaml'

puts "generate_tags.rb loaded successfully"

Jekyll::Hooks.register :site, :post_read do |site|
  puts "generate_tags.rb: running tag page generator (post_read hook)"

  # -----------------------------
  # 1. Collect tags from posts
  # -----------------------------
  post_tags = Hash.new(0)
  site.posts.docs.each do |post|
    Array(post.data['tags']).each { |t| post_tags[t.to_s.strip] += 1 }
  end

  # -----------------------------
  # 2. Collect tags from vocabulary
  # -----------------------------
  vocab_tags = Hash.new(0)
  if site.data['vocabulary'].is_a?(Array)
    site.data['vocabulary'].each do |entry|
      Array(entry['tags']).each { |t| vocab_tags[t.to_s.strip] += 1 }
    end
  end

  # -----------------------------
  # 3. Merge all tags
  # -----------------------------
  all_tags = post_tags.merge(vocab_tags) { |_tag, post_count, vocab_count| post_count + vocab_count }
  sorted_tags = all_tags.keys.compact.uniq.sort_by(&:downcase)

  puts "generate_tags.rb: Found tags: #{sorted_tags.join(', ')}"

  # -----------------------------
  # 4. Create tag pages in memory (no .md files)
  # -----------------------------
  sorted_tags.each do |raw_tag|
    next if raw_tag.empty?

    # Normalize slug: spaces → hyphens, remove punctuation
    slug = raw_tag.downcase.strip.gsub(/\s+/, '-').gsub(/[^\w-]/, '')

    dir = File.join('tags', slug)
    filename = 'index.html'

    page = Jekyll::PageWithoutAFile.new(site, site.source, dir, filename)
    page.content = ""  # layout handles the content
    page.data['layout'] = 'tag'
    page.data['tag'] = raw_tag
    page.data['title'] = "Posts tagged \"#{raw_tag}\""
    page.data['permalink'] = "/tags/#{slug}/"

    # Counts for use in layouts if needed
    page.data['counts'] = {
      'posts' => post_tags[raw_tag],
      'vocabulary' => vocab_tags[raw_tag],
      'total' => post_tags[raw_tag] + vocab_tags[raw_tag]
    }

    site.pages << page

    puts "generate_tags.rb: added /tags/#{slug}/ (#{page.data['counts']['total']} items)"
  end

  # -----------------------------
  # 5. Debug: list all generated tag pages
  # -----------------------------
  puts "🔍 Listing pages that match /tags/:"
  site.pages.select { |p| p.url =~ %r{^/tags/} }.each do |p|
    puts " - #{p.url} (layout: #{p.data['layout']})"
  end
end
