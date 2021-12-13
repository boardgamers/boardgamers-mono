---
home: true
heroImage: /logo.svg
tagline: Docs for the boardgamers ecosystem
actionText: Quick Start →
actionLink: /guide/
xfeatures:
  - title: Hot game loading
    details: Boardgames can be loaded and configured on the platform without any need for a restart
  - title: Game engine utilities
    details: We provide a module to help standardize turn-based game implementations
  - title: Community
    details: Check us out at <a href="//boardgamers.space">boardgamers.space</a>!
footer: Made with ❤️
---

<div class="features">
  <div class="feature" v-for="feat in $page.frontmatter.xfeatures">
    <h2><a v-bind:href="feat.link">{{ feat.title }}</a></h2>
    <p v-html=feat.details></p>
  </div>
</div>
