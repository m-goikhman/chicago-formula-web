(function loadExerciseModules() {
    const version = '20260511';
    const basePath = 'js/exercises/';
    const files = [
        'match-words.js',
        'sentence-builder.js',
        'suspects-drag.js',
        'fill-in-the-blanks.js',
        'pick-explain.js'
    ];

    files.forEach((file) => {
        document.write(`<script src="${basePath}${file}?v=${version}"><\/script>`);
    });
})();
