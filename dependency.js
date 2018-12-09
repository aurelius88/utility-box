const fs = require( "fs" );
const path = require( "path" );
const https = require( "https" );
const { pipeline } = require( "stream" );

const FILE_NAME = "module.json";
const STATUS_DOWNLOAD_SUCCESS = "downloaded";
const STATUS_DOWNLOAD_FAILED = "failed-download";
const STATUS_FILE_FAILED = "failed-saving-file";
const STATUS_RESOLVED = "resolved";

//
// SAMPLE
//
// const DEPENDENCIES = [
//     {
//         name: "your-module-dependency",
//         servers: ["https://your.address.to/your/module/", ...]
//     }
// ];
//
// module.exports = function yourModule() {
//     const Dependency = require( "./dependency" );
//     if ( !Dependency.testDependencies( DEPENDENCIES ) ) {
//         const dep = new Dependency( DEPENDENCIES, mod );
//         dep.resolveDependencies();
//         return;
//     }
//     ...
//     let mod = require("your-module-dependency");
//     ...
// }

class Dependency {
    constructor(
        dependencies,
        mod,
        moduleBase = ( mod && path.join( mod.rootFolder, ".." ) ) || path.join( __dirname, ".." )
    ) {
        if ( typeof dependencies === "string" ) dependencies = [dependencies];
        if ( !Array.isArray( dependencies ) ) throw new Error( "'dependencies' should be an array." );
        if ( !mod ) throw new Error( "'mod' should be defined." );
        this.mod = mod;
        this.moduleBase = moduleBase;
        this.dependencies = dependencies;
    }

    setDebug( debug ) {
        this.debug = debug;
    }

    static _testInnerType( array, type ) {
        return !array.some( x => typeof x != type );
    }

    static buildDependency( name, servers ) {
        if ( typeof name != "string" )
            throw new TypeError( `Type of first argument 'name' was ${typeof name}, but should be a string.` );
        if ( !Array.isArray( servers ) ) servers = [servers];
        if ( !Dependency._testInnerType( servers, "string" ) )
            throw new TypeError(
                `Type of one element of second argument 'servers' was not string, but should be a string.`
            );
        return { name, servers };
    }

    async downloadAll( basePath = this.moduleBase ) {
        let dependencies = this.dependencies;
        if ( !Array.isArray( dependencies ) && !dependencies.length )
            return Promise.reject({ dependencies, status: "rejected" });
        return Promise.all( dependencies.map( x => Dependency.download( x, basePath ) ) ).then( results => {
            let downloadedModules = [];
            let resolvedModules = [];
            let rejectedModules = [];
            for ( let result of results ) {
                if ( result.status == STATUS_DOWNLOAD_SUCCESS ) downloadedModules.push( result.dependency );
                else if ( result.status == STATUS_RESOLVED ) resolvedModules.push( result.dependency );
                else rejectedModules.push( result.dependency );
            }
            if ( rejectedModules.length ) {
                console.log(
                    `[${new Date().toLocaleTimeString()}][INFO][ep-calc] Some dependencies could not be downloaded:
 - ${rejectedModules.map( m => m.name ).join( "\n - " )}`
                );
            } else {
                console.log(
                    `[${new Date().toLocaleTimeString()}][INFO][ep-calc] Successfully downloaded dependencies.`
                );
            }
            return { downloaded: downloadedModules, resolved: resolvedModules, rejected: rejectedModules };
        });
    }

    static async download( dependency, basePath = this.moduleBase ) {
        try {
            // check if not already available
            require( dependency.name );
            let data = JSON.parse( fs.readFileSync( path.join( basePath, dependency.name ) ), "utf8" );
            if ( typeof data.servers[0] === "string" )
                return {
                    dependency,
                    status: STATUS_RESOLVED
                };
            else throw Error();
        } catch ( err ) {
            //
            let dirPath = path.join( basePath, dependency.name );
            try {
                fs.mkdirSync( dirPath );
            } catch ( err ) {
                if ( err.code != "EEXIST" ) throw err;
            }
            let filePath = path.join( dirPath, FILE_NAME );
            let fileStream = fs.createWriteStream( filePath, {
                flags: "w"
            });
            return new Promise( ( resolve, reject ) => {
                fileStream.on( "ready", () =>
                    Dependency.downloadModuleFile( fileStream, dependency.servers )
                        .then( () =>
                            resolve({
                                dependency,
                                status: STATUS_DOWNLOAD_SUCCESS
                            })
                        )
                        .catch( err => {
                            resolve({
                                dependency,
                                status: STATUS_DOWNLOAD_FAILED,
                                error: err
                            });
                        })
                );
                fileStream.on( "error", err => {
                    resolve({
                        dependency,
                        status: STATUS_FILE_FAILED,
                        error: err
                    });
                    fileStream.end();
                });
            });
        }
    }

    static async downloadModuleFile( fileWriter, servers ) {
        for ( let server of servers ) {
            let finished = await new Promise( ( resolve, reject ) =>
                https.get( server + FILE_NAME, res => {
                    const { statusCode } = res;
                    const contentType = res.headers["content-type"];
                    if ( statusCode !== 200 ) {
                        console.error(
                            `[${new Date().toLocaleTimeString()}][ERROR][ep-calc] Failed to download module.json. Request Status Code: ${statusCode}.`
                        );
                        res.destroy();
                    } else if ( !/^text\/plain/.test( contentType ) ) {
                        console.error(
                            `[${new Date().toLocaleTimeString()}][ERROR][ep-calc] Failed to download module.json. Invalid content-type. Expected text/plain but received ${contentType}.`
                        );
                        res.destroy();
                    } else {
                        pipeline( res, fileWriter, err => {
                            if ( err ) {
                                console.log(
                                    `[${new Date().toLocaleTimeString()}][INFO][ep-calc] Could not download ${FILE_NAME} from ${server}: ${
                                        err.message
                                    }`
                                );
                            } else {
                                resolve( err === undefined );
                            }
                        });
                    }
                })
            );
            if ( finished ) return server;
        }
        throw new Error( `Could not download ${FILE_NAME} from any server.` );
    }

    async updateDependencies( modules, moduleBase = this.moduleBase ) {
        const { region: REGION, updatelog: UPDATE_LOG, dnsservers: DNS_SERVERS } = require( "../../config.json" );
        const REGION_SHORT = REGION.toLowerCase().split( "-" )[0];
        const update = require( "../../lib/update" );
        return update( moduleBase, modules, UPDATE_LOG, true, REGION_SHORT )
            .then( updateResult => {
                if ( !updateResult["tera-data"])
                    console.log( "WARNING: There were errors updating tera-data. This might result in further errors." );
                return updateResult;
            })
            .catch( e => {
                console.log( "ERROR: Unable to auto-update: %s", e );
            });
    }

    loadDependencies( modules, moduleBase ) {
        // load dependencies
        let notLoaded = [];
        let mod = this.mod;
        for ( let m of modules ) {
            m.options.rootFolder = path.join( moduleBase, m.name );
            if ( !mod.load( m.name, module, false, m.options ) ) {
                notLoaded.push( m );
            }
        }
        return notLoaded;
    }

    static canRequire( moduleName ) {
        try {
            require.resolve( moduleName );
            return true;
        } catch ( _ ) {
            return false;
        }
    }

    static testDependencies( dependencies ) {
        if ( typeof dependencies == "string" ) dependencies = [dependencies];
        if ( !Array.isArray( dependencies ) ) return false;
        return dependencies.every( d => Dependency.canRequire( d.name ) );
    }

    async resolveDependencies() {
        let downloaded = this.downloadAll( this.moduleBase );
        downloaded.catch( error =>
            console.error(
                `[${new Date().toLocaleTimeString()}][ep-calc][ERROR] Could not download dependencies.
        Please download manually:
        ${JSON.stringify( this.dependencies )}${"module.json"}\n`,
                error
            )
        );
        let updated = downloaded.then( downloadResult => {
            if ( !downloadResult ) return Promise.reject( "Nothing to update." );
            if ( this.debug ) console.log( "DOWNLOAD RESULT: " + JSON.stringify( downloadResult ) );
            let downloadedModules = downloadResult.downloaded.map( d => d.name );
            return this.updateDependencies( downloadedModules, this.moduleBase );
        });
        let loaded = updated.then( updateResult => {
            if ( this.debug ) console.log( "UPDATE RESULT: " + JSON.stringify( updateResult ) );
            if ( !updateResult || !updateResult["updated"].length ) return Promise.reject( "Nothing to load." );
            let notLoaded = this.loadDependencies( updateResult["updated"], this.moduleBase );
            if ( this.debug ) console.log( "NOT LOADED: " + JSON.stringify( notLoaded ) );
            return new Promise( ( resolve, reject ) => {
                if ( notLoaded.length > 0 ) {
                    reject( notLoaded );
                } else {
                    resolve();
                }
            });
        });
        await loaded
            .then( () => {
                this.mod.unload( this.mod.name );
                this.mod.load( this.mod.name, module, true, this.mod.options );
            })
            .catch( err => console.error( err ) );
    }
}

module.exports = Dependency;
