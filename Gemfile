source "https://rubygems.org"

# ------------------------------------------------------------
# 👋 Hello! This Gemfile controls which Jekyll version is used.
# Run `bundle install` after editing.
#
# Use `bundle exec jekyll serve` or `bundle exec jekyll build`
# to ensure the correct versions load.
# ------------------------------------------------------------

# ------------------------------------------------------------
# ✅ Use Jekyll directly (not github-pages)
# GitHub Pages gem disables all custom plugins (like _plugins/generate_tags.rb).
# By using vanilla Jekyll, your local builds will include your plugin.
# ------------------------------------------------------------
gem "jekyll", "~> 4.3"

# ------------------------------------------------------------
# 🧩 Official Jekyll plugins you’re already using
# ------------------------------------------------------------
group :jekyll_plugins do
  gem "jekyll-feed", "~> 0.12"
  gem "jekyll-seo-tag"
  gem "jekyll-paginate"
  gem "jekyll-include-cache"
  gem "jekyll-target-blank"
  gem "jekyll-archives"
end

# ------------------------------------------------------------
# ⚙️ Platform-specific helpers (Windows)
# ------------------------------------------------------------
platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

gem "wdm", "~> 0.1", platforms: [:mingw, :x64_mingw, :mswin]
gem "http_parser.rb", "~> 0.6.0", platforms: [:jruby]

# ------------------------------------------------------------
# 🧱 Notes:
# - `github-pages` gem is intentionally REMOVED because it blocks _plugins.
# - Your site will still deploy fine if built locally and pushed to GitHub.
# - To use GitHub Pages’ build server instead, re-add:
#       gem "github-pages", group: :jekyll_plugins
#   ...but then _plugins will be ignored again.
# ------------------------------------------------------------
