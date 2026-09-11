/* Show a scratch link only if scratch.html is actually served (local).
   GitHub Pages 404s it; the nav stays clean on the public site. */
(function () {
  const href = "scratch.html";
  if (/scratch\.html$/i.test(location.pathname || "")) return;

  function inject() {
    document.querySelectorAll(".navline").forEach((el) => {
      if (el.querySelector(`a[href="${href}"]`)) return;
      el.insertAdjacentHTML("beforeend", ` · <a href="${href}">scratch</a>`);
    });
    document.querySelectorAll("footer").forEach((el) => {
      if (el.querySelector(`a[href="${href}"]`)) return;
      const node = document.createElement("span");
      node.innerHTML = ` · <a href="${href}">scratch</a> `;
      const credit = el.querySelector(".grok-credit");
      if (credit) el.insertBefore(node, credit);
      else el.appendChild(node);
    });
  }

  function ok(r) { return r && r.ok; }

  fetch(href, { method: "HEAD", cache: "no-store" })
    .then((r) => {
      if (ok(r)) { inject(); return; }
      if (r.status === 405 || r.status === 501) {
        return fetch(href, { method: "GET", cache: "no-store" }).then((g) => { if (ok(g)) inject(); });
      }
    })
    .catch(() => {
      fetch(href, { method: "GET", cache: "no-store" })
        .then((g) => { if (ok(g)) inject(); })
        .catch(() => {});
    });
})();
