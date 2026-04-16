const DEBUG = process.env.DEBUG === '1';

function logMethodEntry(methodName, params) {
    if (DEBUG) {
        console.log(`→ ${methodName}`, JSON.stringify(params));
    } else {
        console.log(`→ ${methodName}`);
    }
}

function logMethodExit(methodName, result) {
    if (DEBUG) {
        const summary = Array.isArray(result) ? `[${result.length} items]` : (result?._id || '');
        console.log(`← ${methodName}`, summary);
    }
}

module.exports = {
    logMethodEntry,
    logMethodExit
};
