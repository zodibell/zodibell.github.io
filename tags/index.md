---
layout: default
title: All Tags
permalink: /tags/
---

<h1>List of Posts and Their Tags</h1>

<!-- List of Posts and their Tags -->
<ul>
  {% for post in site.posts %}
    <li>
      {{ post.title }} — Tags: 
      {% for tag in post.tags %}
  <a href="{{ site.baseurl }}/tags/{{ tag | slugify }}/">{{ tag }}</a>{% unless forloop.last %}, {% endunless %}
{% endfor %}

    </li>
  {% endfor %}
</ul>

<!-- Bulleted list of clickable tags in alphabetical order -->
<h1>Alphabetical List of Tags (Forthcoming)</h1>
<ul>
  {% assign sorted_tags = site.tags | sort %}
  {% for tag in sorted_tags %}
    <li>
      <a href="{{ site.baseurl }}/tags/{{ tag[0] | slugify }}/">
        {{ tag[0] }}
      </a>
    </li>
  {% endfor %}
</ul>

<!-- Debug Tests 
{% if site.tags %}
  <p><strong>site.tags loaded ✅</strong></p>
{% else %}
  <p><strong>site.tags is empty ❌</strong></p>
{% endif %}

<h2>Debug Output</h2>
<pre>
  {% for tag in site.tags %}
    {{ tag[0] }}: {{ tag[1] | size }} posts
  {% endfor %}
</pre>

<h2>Test Tags List</h2>
<ul>
  {% for tag in site.tags %}
    <li>
      <a href="{{ site.baseurl }}/tags/{{ tag[0] | slugify }}/">{{ tag[0] }} ({{ tag[1] | size }})</a>
    </li>
  {% endfor %}
</ul> -->


<!-- List of Tags 
<div class="tag-index">
  <h2>Explore by Tag</h2>
  <ul>
    {% assign sorted_tags = site.tags | sort %}
    {% for tag in sorted_tags %}
      <li>
        <a href="{{ site.baseurl }}/tags/{{ tag[0] | slugify }}/">
          {{ tag[0] }} ({{ tag[1] | size }})
        </a>
      </li>
    {% endfor %}
  </ul>
</div> -->

<!-- Test Code 
<p>site.tags size: {{ site.tags | size }}</p> -->
