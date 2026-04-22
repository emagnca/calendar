'use strict';

const { app, init } = require('./handler');

const PORT = process.env.CAL_PORT || 3000;

init().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.info('Listening on port ' + PORT);
    });
}).catch(err => {
    console.error('Failed to initialise:', err);
    process.exit(1);
});
