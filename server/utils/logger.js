function formatParams(params) {
    return JSON.stringify(params, (key, value) => {
        // Handle Date objects specially
        if (value instanceof Date) {
            return value.toISOString();
        }
        return value;
    }, 2);
}

function logMethodEntry(methodName, params) {
    console.log(`--->${methodName} ${formatParams(params)}`);
}

function logMethodExit(methodName, result) {
    console.log(`<---${methodName} ${formatParams(result)}`);
}

module.exports = {
    logMethodEntry,
    logMethodExit
};
