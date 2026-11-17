/* Früh ausgeführt (im <head>):
   - markiert, dass JavaScript aktiv ist
   - aktiviert die Bewegungs-Ausgangszustände nur, wenn keine reduzierte Bewegung gewünscht ist
   - Sicherheitsnetz: Lädt main.js nicht, werden alle Inhalte nach 4 s trotzdem sichtbar */
(function () {
  var root = document.documentElement;
  root.classList.replace('no-js', 'js');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) root.classList.add('motion');
  // Intro nur beim ersten Besuch je Sitzung, nur auf der Startseite ohne Sprungziel
  try {
    if (!reduce && !location.hash && document.currentScript && document.currentScript.hasAttribute('data-intro') && !sessionStorage.getItem('brk.intro')) {
      root.classList.add('intro-on');
      setTimeout(function () { if (!window.__brkFx) root.classList.remove('intro-on'); }, 2500);
    }
  } catch (e) { /* sessionStorage gesperrt: kein Intro */ }
  setTimeout(function () { if (!window.__brkReady) root.classList.remove('motion'); }, 4000);
})();
