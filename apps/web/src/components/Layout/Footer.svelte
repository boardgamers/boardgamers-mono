<footer class="footer">
  <div class="container">
    <div class="row">
      <div class="col-auto">
        <a href="https://forum.boardgamers.space" class="text-muted">Forum</a>
      </div>
      <div class="col-auto">
        <a href="mailto:contact@boardgamers.space" class="text-muted">Contact</a>
      </div>
      <div class="col-auto">
        <a sveltekit:prefetch href="/page/source" class="text-muted">Source</a>
      </div>
      <div class="col-auto">
        <a sveltekit:prefetch href="/page/privacy-policy" class="text-muted">Privacy policy</a>
      </div>
      <div class="col-auto">
        <a sveltekit:prefetch href="/page/credits" class="text-muted">Credits</a>
      </div>
    </div>
  </div>
</footer>

<style>
  .footer {
    margin-top: var(--footer-margin);
    width: 100%;
    min-height: var(--footer-height); /* Set the fixed height of the footer here */
    line-height: var(--footer-height); /* Vertically center the text there */
    background-color: #f5f5f5;
  }
</style>
