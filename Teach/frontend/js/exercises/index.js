(function loadExerciseModules() {
    const version = '20260430';
    const basePath = 'js/exercises/';
    const files = [
        'match-words.js',
        'sentence-builder.js',
        'suspects-drag.js',
        'fill-in-the-blanks.js'
    ];

    files.forEach((file) => {
        document.write(`<script src="${basePath}${file}?v=${version}"><\/script>`);
    });
})();
