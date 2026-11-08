// Google Analytics setup (loaded from index.html; a file rather than an inline script so account
// pages can run under a strict Content-Security-Policy). One-time tokens in reset / invite links
// are never sent: the reported page URL has them replaced (see src/accounts/privacy.js).
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
(function () {
  var loc = location.href;
  try {
    var u = new URL(loc);
    ['token', 'code', 'secret', 'otp', 'callbackURL'].forEach(function (p) { if (u.searchParams.has(p)) u.searchParams.set(p, 'redacted'); });
    loc = u.href;
  } catch (e) { loc = loc.replace(/([?&](?:token|code|secret|otp)=)[^&#]*/g, '$1redacted'); }
  gtag('config', 'G-6G13WC6FHH', { page_location: loc });
})();
