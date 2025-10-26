---
layout: default
title: All Tags
permalink: /tags/
---

<h1>All Tags</h1>

<!-- 1️⃣ List of Posts and their tags -->
<h2>Posts and Their Tags</h2>
<ul>
  {% for post in site.posts %}
    <li>
      {{ post.title }} — Tags:
      {% for tag in post.tags %}
        <a href="{{ '/tags/' | append: tag | slugify | append: '/' | relative_url }}">{{ tag }}</a>{% unless forloop.last %}, {% endunless %}
      {% endfor %}
    </li>
  {% endfor %}
</ul>

<!-- 2️⃣ List of Vocabulary Tags with counts -->
<h2>Vocabulary Tags</h2>
{% assign vocab_tags_all = site.data.vocabulary | map: 'tags' | compact | flatten %}
{% assign vocab_tags_unique = vocab_tags_all | uniq | sort_natural %}

<ul>
  {% for tag in vocab_tags_unique %}
    {% assign count = 0 %}
    {% for entry in site.data.vocabulary %}
      {% if entry.tags contains tag %}
        {% assign count = count | plus: 1 %}
      {% endif %}
    {% endfor %}
    <li>
      <a href="{{ '/tags/' | append: tag | slugify | append: '/' | relative_url }}">{{ tag }}</a> ({{ count }} vocab)
    </li>
  {% endfor %}
</ul>

<!-- 3️⃣ Alphabetical list of all tags with counts -->
<h2>Alphabetical List of Tags</h2>

<ul class="all-tags">
  {% assign post_tags_all = site.posts | map: 'tags' | compact | flatten %}
  {% assign post_tags_unique = post_tags_all | uniq %}
  {% assign all_tags = post_tags_unique | concat: vocab_tags_unique | uniq | sort_natural %}

  {% for tag in all_tags %}
    {% assign post_count = 0 %}
    {% for post in site.posts %}
      {% if post.tags contains tag %}
        {% assign post_count = post_count | plus: 1 %}
      {% endif %}
    {% endfor %}

    {% assign vocab_count = 0 %}
    {% for entry in site.data.vocabulary %}
      {% if entry.tags contains tag %}
        {% assign vocab_count = vocab_count | plus: 1 %}
      {% endif %}
    {% endfor %}

    <li>
      <a href="{{ '/tags/' | append: tag | slugify | append: '/' | relative_url }}">{{ tag }}</a>
      {% if post_count > 0 %} ({{ post_count }} post{% if post_count > 1 %}s{% endif %}){% endif %}
      {% if vocab_count > 0 %} ({{ vocab_count }} vocab){% endif %}
    </li>
  {% endfor %}
</ul>
