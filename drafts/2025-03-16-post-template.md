---
layout: post
title: "Title of Post"
date: 2025-08-18
tags:
    - "poetry"
    - "randomness"
    - "love"
image: "assets/images/image_name.jpg"
image_alt: "Description of image" 
image_caption: "Image Source: https://www.publicdomainpictures.net"


---
Blog post content goes {% include zb_bloc.html %} here.

## Reminders for iOS
My toolkit for blogging from my phone includes: 
- [Markdown](https://www.markdownguide.org/): language and syntax
- [GitHub](https://github.com/): hosting and version control
- [Working Copy](https://workingcopy.app/manual/introduction): Git client for iOS
- [1Writer](https://1writerapp.com/): markdown editor
- [Canva](https://www.canva.com/): image editor and creator

## My workflow for creating a new post from my phone is:
To use Working Copy and 1Writer together on iOS, follow these steps:

    1. Set up your Git repository in Working Copy:
       -  Open Working Copy and clone your desired Git repository (e.g., from GitHub, GitLab) or create a new local repository.
       - Ensure the repository contains the Markdown files you intend to edit. 
    2. Enable folder sync in Working Copy (if needed):
       - If you want to edit files that are not directly within the Working Copy app's sandboxed environment, you can use Working Copy's "Setup Folder Sync" feature. This allows you to sync a repository folder with a folder in iCloud Drive or another location accessible by other apps. 
    3. Access files from Working Copy within 1Writer:
        - Open 1Writer.
        - Navigate to the file browser within 1Writer.
        - Tap the "+" button or "Add Location" (depending on the specific UI version) and select "Working Copy" from the available locations.
        - Browse to the desired folder or file within your Working Copy repository and open it. 
    4. Edit in 1Writer:
        - Make your desired edits to the Markdown file within 1Writer. 1Writer will automatically save the changes to the file in its original location, which is within the Working Copy repository. 
    5. Commit and push changes in Working Copy:
        - Switch back to Working Copy.
        - You will see that the files you edited in 1Writer are marked as modified.
        - Review the changes, write a commit message, and commit the changes to your local repository.
        - Push the committed changes to your remote Git repository to synchronize them. 

## My workflow for previewing my blog:
When I am tinkering with my GitHub site locally, I use [Jekyll](https://jekyllrb.com/docs/) to preview my work. Here are the commands I use to preview & build my static site:  

```
bundle exec jekyll build
bundle exec jekyll serve
```
Once the site is built and available on my local server, I navigate to http://localhost:4000/ to view it. 

# Git Commands 
The standard commands for updating my GitHub site are second-nature by now. But in case a refresher is needed, here are the commands I typically use:  

```
cd zodibell.github.io
git status (check on changes)
git fetch
git pull (update local repo)
git add . (add changes)
git commit -m "message"
git push
```

If something goes wrong, refer to the appropriate [Git Guides](https://github.com/git-guides) for assistance. 
- [status](https://github.com/git-guides/git-status)
- [pull](https://github.com/git-guides/git-pull)
- [add](https://github.com/git-guides/git-add)
- [commit](https://github.com/git-guides/git-commit)
- [push](https://github.com/git-guides/git-push) 

If you get tangled up in the terminal, [here's a quick reference for the most common commands](https://gist.github.com/bradtraversy/cc180de0edee05075a6139e42d5f28ce). 