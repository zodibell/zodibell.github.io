# zodibell.github.io
Zodi's GitHub Site

# Personal Reminders
Here are some things you need to fix:
- Pick better fonts - https://fonts.google.com/ 
- **Important**: The tag section needs work. The alphabetized collection needs to display in the "tags" page.
- The blog post grid needs to be cleaned up. The grid is displaying correctly, but I think the images could be formatted better.
- Eventually, maybe:
  - The blog post pages need a comment section. Not Disqus, though. But maybe not because of spam?
  - Add links to Ko-fi, Beehiiv, & Privacy Policy to footer?
    - Work on Beehiiv template. This isn't urgent because I don't have an audience **yet.**
  - How to dress things up. Adjust color? Gradients? Hovering? Shadows? 


# Documentation

## Steps to Dynamically Display Blog Posts
I used the following steps to  dynamically populate my posts section with blog data, and I can easily add new posts without changing my HTML structure.

1. Organize Posts
- Store blog posts in the `_posts` directory.
- Name blog files in the format `YYYY-MM-DD-title.md` or `.markdown.` For example:

```
_posts/
  2025-03-15-first-blog-post.md
  2025-03-10-second-blog-post.md
  2025-03-05-third-blog-post.md
  ```

2. Add Front Matter
Each post should include front matter with metadata like `title`, `tags`, `date`, and `image`. For example (in markdown):

```
---
layout: post
title: "Post Title"
date: 2025-03-27
tags:
    - "lifestyle"
    - "inspiration"
image: "assets/images/post_image.png"
image_alt: "Screenshot showing image centered in Jekyll layout"
published: true  (Set to false to draft the post)
excerpt: "Short description for summary cards."
permalink: /custom-url/
---
Blog content goes here.
```

3. Update the `index.html` file
Use Liquid to loop through posts dynamically and display the required structure. Here's an example `index.html` template:
```
html
<section class="posts">
  <!-- Loop through posts -->
  {% for post in site.posts %}
    {% if forloop.index <= 9 %} <!-- Limit posts to 3 rows (9 posts) -->
      {% if forloop.index | modulo: 3 == 1 %}
        <div class="row"> <!-- Start a new row every 3 posts -->
      {% endif %}

      <div class="post">
        <img src="{{ post.image }}" alt="{{ post.title }}">
        <div class="tags">
          {% for tag in post.tags %}
            <span>#{{ tag }}</span>
          {% endfor %}
        </div>
        <p class="date">{{ post.date | date: "%B %d, %Y" }}</p>
        <h2><a href="{{ post.url }}">{{ post.title }}</a></h2>
      </div>

      {% if forloop.index | modulo: 3 == 0 %}
        </div> <!-- Close the row -->
      {% endif %}
    {% endif %}
  {% endfor %}
</section>

<!-- Pagination -->
<div class="pagination">
  {% if paginator.previous_page %}
    <a href="{{ paginator.previous_page_path }}">&laquo; Previous</a>
  {% endif %}

  {% for page in paginator.pages %}
    <a href="{{ page.path }}">{{ page.index }}</a>
  {% endfor %}

  {% if paginator.next_page %}
    <a href="{{ paginator.next_page_path }}">Next &raquo;</a>
  {% endif %}
</div>

<!-- Tags Section -->
<div class="tags-buttons">
  {% assign all_tags = site.tags | keys %}
  {% for tag in all_tags %}
    <button>#{{ tag }}</button>
  {% endfor %}
</div>
```

4. Explanations
- Post Loop:
    - `{% for post in site.posts %}` iterates through all posts stored in the `_posts` directory.
    - It displays metadata (`title`, `tags`, `image`, and `date`) dynamically.

- Limiting Posts:
    - Use `{% if forloop.index <= 9 %}` to limit the displayed posts to the first 9 (3 rows).

- Row Structure:
    - Every 3 posts (`modulo: 3`) creates a new row using `<div class="row">`.

- Pagination:
    - Jekyll's built-in paginator plugin can handle page navigation.
    - Ensure the `_config.yml` file enables pagination:

```
yaml
paginate: 9 # Posts per page
paginate_path: "/page:num"
```

- Tags Buttons:
    - `{% assign all_tags = site.tags | keys %}` collects all unique tags and displays them as buttons.

5. Configure `_config.yml` 
Ensure the  `_config.yml` file is set up correctly for pagination and tags:

```
yaml
paginate: 9 # Number of posts per page
paginate_path: "/page:num"
```

6. Style the Layout
- Add CSS to ensure the posts are displayed properly in a 3-column layout, as shown earlier.

7. Debug HTML Issues
To manually view the HTML without Jekyll processing. 
- Liquid tags (`{% for post in site.posts %}`) won’t work, so these sections will break.
- Replace dynamic content with static placeholders to preview:
```
html
<div class="post">
  <img src="assets/images/post1.jpg" alt="First Blog Post">
  <div class="tags">
    <span>#Tag1</span>
    <span>#Tag2</span>
  </div>
  <p class="date">March 15, 2025</p>
  <h2><a href="/post1">First Blog Post</a></h2>
</div>
```
