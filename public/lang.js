// 最初の言葉を、ページを描く前に決める（ちらつかないように）。URL の ?lang=、前に選んだ言葉、ブラウザーの言葉の順。
// URL の ?lang= で選んだ言葉も、JP / EN のボタンと同じく、この端末に覚える（ほかのページへ移っても同じ言葉のまま）。
(function () {
  var KEY = 'voice-match-lang';
  var l = 'ja';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    var s = null;
    if (q === 'en' || q === 'ja') {
      s = q;
      try {
        localStorage.setItem(KEY, q);
      } catch (e) {}
    } else {
      try {
        s = localStorage.getItem(KEY);
      } catch (e) {}
    }
    l = s === 'en' || s === 'ja' ? s : (navigator.language || '').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
  } catch (e) {}
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
})();
