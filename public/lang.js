// 最初の言葉を、ページを描く前に決める（ちらつかないように）。URL の ?lang=、前に選んだ言葉、ブラウザーの言葉の順。
(function () {
  var l = 'ja';
  try {
    var q = new URLSearchParams(location.search).get('lang');
    var s = q === 'en' || q === 'ja' ? q : localStorage.getItem('voice-match-lang');
    l = s === 'en' || s === 'ja' ? s : (navigator.language || '').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
  } catch (e) {}
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
})();
