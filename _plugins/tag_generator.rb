module Jekyll
    class TagPageGenerator < Generator
      safe true
  
      def generate(site)
        site.tags.each do |tag, posts|
          site.pages << TagPage.new(site, site.source, tag, posts)
        end
      end
    end
  
    class TagPage < Page
      def initialize(site, base, tag, posts)
        @site = site
        @base = base
        @dir = "/tag/#{tag.slugify}"
        @name = "index.html"
  
        self.process(@name)
        self.read_yaml(File.join(base, '_layouts'), 'tag.html')
        self.data['tag'] = tag
        self.data['title'] = "Posts Tagged: #{tag}"
      end
    end
  end
  