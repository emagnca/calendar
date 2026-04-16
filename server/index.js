'use strict';

const { app } = require('./handler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
    console.info('Listening on port ' + PORT);
});
