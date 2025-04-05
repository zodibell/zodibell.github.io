module Jekyll
    class TagPageGenerator < Generator
      safe true
  
      def generate(site)
        site.tags.each do |tag, posts|
          site.pages << TagPage.new(site, tag)
        end
      end
    end
  
    class TagPage < Page
      def initialize(site, tag)
        @site = site
        @base = site.source
        @dir  = File.join('tags', tag.downcase.strip.gsub(' ', '-').gsub(/[^\w-]/, ''))
        @name = 'index.html'
  
        self.process(@name)
        self.read_yaml(File.join(@base, '_layouts'), 'tag.html')
        self.data['tag'] = tag
        self.data['title'] = "Posts tagged with \"#{tag}\""
      end
    end
  end
  