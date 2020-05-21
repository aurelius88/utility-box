"use strict";
const util = require("util");

const DefaultSettings = {
    scanVerbose: false,
    consoleOutput: false
};

// from_ver, to_ver = version number; settings = "old settings"
module.exports = function MigrateSettings( from_ver, to_ver, settings ) {
    if ( from_ver === undefined ) {
        // Migrate legacy config file
        return Object.assign( Object.assign({}, DefaultSettings ), settings );
    } else if ( from_ver === null ) {
        // No config file exists, use default settings
        return DefaultSettings;
    } else {
        // Migrate from older version (using the new system) to latest one
        let migratedSettings = null;
        for( let cur_ver = from_ver; cur_ver < to_ver; cur_ver++ ) {
            switch ( cur_ver ) {
                case 1:
                    migratedSettings = Object.assign({}, DefaultSettings );
                    migratedSettings.consoleOutput = settings.consoleOutput;
                    break;
                default:
                    throw new Error( `Missing version migration. Current:${cur_ver}, From:${from_ver}, To:${to_ver}` );
            }
        }
        return from_ver == to_ver ? settings : migratedSettings;
    }
};
