const bunyan = require( "bunyan" );
const path = require( "path" );
const fs = require( "fs" );

const COLOR_ENABLE = "#56B4E9";
const COLOR_DISABLE = "#e64500";
const COLOR_COMMAND = "#e6a321";
const COLOR_VALUE = "#09d1d1";
const COLOR_HIGHLIGHT = "#81ee7b";
const SOFT_CAP_MOD_START = 0.88945;
const SOFT_CAP_MOD_END = SOFT_CAP_MOD_START + 0.2;

module.exports = function utilityBox( mod ) {
    mod.game.initialize(["me", "contract"]);
    const ROOT_COMMAND = "util";
    const POSITIONS_FILE_NAME = "positions.json";
    const POSITIONS_PATH = path.resolve( __dirname, POSITIONS_FILE_NAME);
    const OPCODES_PATH = path.join( __dirname, "opcodes" );
    const GENERAL_LOG_PATH = path.join( __dirname, "logs" );
    const command = mod.command;
    const HookManager = mod.require["util-lib"]["hook-manager"];
    const hookManager = new HookManager( mod );
    const MessageBuilder = mod.require["util-lib"]["message-builder"];
    const msg = new MessageBuilder();
    const ChatHelper = mod.require["util-lib"]["chat-helper"];
    const chat = new ChatHelper( mod );
    const FileHelper = mod.require["util-lib"]["file-helper"];
    const logger = {};
    if ( !fs.existsSync( OPCODES_PATH ) ) fs.mkdirSync( OPCODES_PATH );
    if ( !fs.existsSync( GENERAL_LOG_PATH ) ) fs.mkdirSync( GENERAL_LOG_PATH );

    let gameId = null,
        scanning = false,
        lastLocation = null,
        positions = new Map(),
        verbose = false,
        version = mod.dispatch.protocolVersion;

    const POSITIONS_DATA = FileHelper.getJsonData( POSITIONS_PATH );
    if ( Array.isArray( POSITIONS_DATA ) ) {
        positions = new Map( POSITIONS_DATA );
    }
    const OPCODE_JSON = "opcodes.json";
    const GROUPED_OPCODE_JSON = "groups.json";
    let OPCODE_FILE_NAME, OPCODE_MAP, GROUPED_OPCODE_MAP;

    OPCODE_FILE_NAME = `../../../node_modules/tera-data/map_base/protocol.${version}.map`;
    OPCODE_MAP = mod.dispatch.protocolMap.code; // opcode -> name
    GROUPED_OPCODE_MAP = FileHelper.groupOpcodes( OPCODE_MAP ); // group (S,C,DBS,...) -> opcode

    //saveJsonData(OPCODE_JSON, Array.from(OPCODE_MAP));
    //saveJsonData(GROUPED_OPCODE_JSON, Array.from(GROUPED_OPCODE_MAP));

    initGroupedOpcodeHooks();
    initFixHooks();

    hookManager.hookGroup( "player-ep-log" );

    mod.game.on( "enter_game", () => {
        gameId = mod.game.me.gameId;
    });

    // dispatch.game.on( 'leave_game', () => {
    // } );

    process.on( "exit", () => {
        let posData = [];
        positions.forEach( ( v, k ) => posData.push([k, v]) );
        FileHelper.saveJsonData( POSITIONS_PATH, posData );
        stopScanning();
    });

    // dispatch.game.contract.on( "begin", () => {
    //     chat.printMessage( "Begin Contract." );
    // } );
    //
    // dispatch.game.contract.on( "end", () => {
    //     chat.printMessage( "End Contract." );
    // } );

    let illegalPosCommands = [];

    let commands = {
        list: {
            opcodes: {
                $default: printOpcodes
            },
            active: {
                $default: printActiveGroups
            },
            templates: {
                $default: printTemplates
            },
            $default: printGroups
        },
        hook: {
            add: {
                $default: function( group, hookName, version, ...vars ) {
                    if ( arguments.length < 4 ) return printHelpList( this.hook.add );
                    if ( typeof version == "string" && !/raw|\*|[0-9]+/.test( version ) ) {
                        return chat.printMessage(
                            `Illegal version "<font color "${COLOR_HIGHLIGHT}">${version}</font>". Should be "<font color "${COLOR_HIGHLIGHT}">*</font>", "<font color "${COLOR_HIGHLIGHT}">raw</font>" or a positive integer number <font color "${COLOR_HIGHLIGHT}">0,1,2,...</font>.`
                        );
                    }
                    if ( !Array.from( OPCODE_MAP.values() ).includes( hookName ) )
                        return chat.printMessage(
                            `There is no hook named "<font color="${COLOR_HIGHLIGHT}">${hookName}</font>".`
                        );

                    chat.printMessage(
                        `Successfully added hook to group:${group}, name: ${hookName}, version: ${version}, vars: ${JSON.stringify(
                            vars
                        )}`
                    );

                    let result = hookManager.addTemplate( group, hookName, version, e => {
                        // used in eval
                        for ( let v of vars ) {
                            let value = eval( "e." + v );
                            if ( typeof value == "bigint" ) value = value.toString();
                            chat.printMessage( v + " = " + JSON.stringify( value ) );
                        }
                    });
                    if ( !result.group ) {
                        chat.printMessage( "Hook does already exist." );
                    }
                }
            },
            remove: {
                id: function( group, id ) {
                    if ( hookManager.removeTemplateAt( group, id ) ) {
                        chat.printMessage(
                            `Template id <font color="${COLOR_VALUE}">${id}</font> in <font color="${COLOR_VALUE}">${group}</font> successfully removed.`
                        );
                    } else {
                        chat.printMessage(
                            `Could not remove template id <font color="${COLOR_VALUE}">${id}</font> in <font color="${COLOR_VALUE}">${group}</font>. Check if group and id are correct.`
                        );
                    }
                },
                $default: function( name, group ) {
                    if ( !name ) printHelpList( this.hook.remove );
                    if ( hookManager.removeTempletByName( name, group ) ) {
                        chat.printMessage(
                            `Template named <font color="${COLOR_VALUE}">${name}</font> ${
                                group ? `in <font color="${COLOR_VALUE}">${group}</font> ` : ""
                            }successfully removed.`
                        );
                    }
                }
            },
            $default() {
                printHelpList( this.hook );
            }
        },
        scan: {
            raw: {
                $default: function( opcode ) {
                    if ( !opcode ) rawScan();
                    else scanOpcode( opcode );
                }
            },
            verbose: {
                $default: switchVerbose
            },
            $default: function( ...groupNameParts ) {
                if ( !groupNameParts || !groupNameParts.length ) switchScanning();
                else switchGroup( groupNameParts );
            }
        },
        pos: {
            save: {
                $default( ...nameParts ) {
                    if ( !nameParts || !nameParts.length ) return printHelpList( this.pos.save );
                    let name = "";
                    for ( let i = 0; i < nameParts.length; i++ ) {
                        name += nameParts[i];
                        if ( i < nameParts.length - 1 ) name += " ";
                    }
                    let illegalCommandIndex = illegalPosCommands.indexOf( name );
                    if ( illegalCommandIndex > -1 ) {
                        let illegalCommands = "";
                        for ( let i = 0; i < illegalPosCommands.length; i++ ) {
                            illegalCommands += illegalPosCommands[i];
                            if ( i < illegalPosCommands.length - 1 ) illegalCommands += ", ";
                        }
                        chat.printMessage(
                            `Position named "<font color="${COLOR_HIGHLIGHT}">${
                                illegalCommands[illegalCommandIndex]
                            }</font>", but you cannot name your position to one of these:<font color="${COLOR_HIGHLIGHT}"> ${illegalCommands}</font>. Please choose another name.`
                        );
                    } else {
                        savePosition( name );
                    }
                }
            },
            list: {
                $default: printPositions
            },
            delete: {
                $default( ...nameParts ) {
                    if ( !nameParts || !nameParts.length ) return printHelpList( this.pos.delete );
                    let name = "";
                    for ( let i = 0; i < nameParts.length; i++ ) {
                        name += nameParts[i];
                        if ( i < nameParts.length - 1 ) name += " ";
                    }
                    if ( positions.delete( name ) ) {
                        chat.printMessage( `Position "<font colot="${COLOR_HIGHLIGHT}">${name}</font>" deleted.` );
                    } else {
                        chat.printMessage(
                            `There is no position with name "<font color="${COLOR_HIGHLIGHT}">${name}</font>".`
                        );
                    }
                }
            },
            reset: {
                $default: positions.clear
            },
            $default() {
                if ( lastLocation && lastLocation.loc !== undefined ) {
                    chat.printMessage( `Current Position:  ${lastLocation.loc}` );
                } else {
                    if ( !hookManager.hasActiveGroup( "movement" ) ) switchGroup( "movement" );
                    chat.printMessage(
                        "No position, yet. Please move one step or jump to get your position. And try it again."
                    );
                }
            }
        },
        use: {
            $default( arg ) {
                if ( arg !== undefined ) {
                    chat.printMessage( `arg1 type: ${typeof arg1}` );
                    useItem( arg );
                } else {
                    chat.printMessage( `Missing item id. e.g.: ${ROOT_COMMAND} use 200999` );
                }
            }
        },
        $default() {
            printHelpList();
        }
    };

    function printHelpList( cmds = commands ) {
        chat.printMessage( cmds.help.long() );
        chat.printMessage( "subcommands:" );
        for ( let c in cmds ) {
            if ( c != "$default" ) {
                chat.printMessage( `<font color="${COLOR_HIGHLIGHT}">${c}</font>  -  ${cmds[c].help.short()}` );
            }
        }
    }
    // initialize HELP
    function helpObject( cmd, short, long ) {
        return {
            short() {
                return short;
            },
            long() {
                return long;
            },
            help: {
                short() {
                    return "Displays this help message.";
                },
                long() {
                    return "Displays this help message.";
                }
            },
            $default() {
                printHelpList( cmd );
            }
        };
    }

    commands.hook.add.help = helpObject(
        commands.hook.add,
        `Adds a hook template that can be activated with "scan".`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook add</font> <font color="${COLOR_VALUE}">group hook-name version variables</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group the hook should be assigned to.\n<font color="${COLOR_VALUE}">hook-name</font> is the name of the hook packet such as "S_CHAT".\n<font color="${COLOR_VALUE}">version</font> is the version of the packet. Should be an integer. Can also be "*" for the latest version or "raw" to create a raw hook.\n<font color="${COLOR_VALUE}">vars</font> are the variables of the packet that should be printed. Each variable name is seperated by a whitespace. There should be at least 1 variable.`
    );

    commands.hook.remove.help = helpObject(
        commands.hook.remove,
        `Removes all hook templates with the specified hook name.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook remove</font> <font color="${COLOR_VALUE}">hook-name group</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group that contains the hook. (optional)\n<font color="${COLOR_VALUE}">hook-name</font> is the name of the hook packet such as "S_CHAT".`
    );

    commands.hook.remove.id.help = helpObject(
        commands.hook.remove.id,
        `Removes a hook template by using the id.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook remove id</font> <font color="${COLOR_VALUE}">group id</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group the hook should be assigned to.\n<font color="${COLOR_VALUE}">id</font> is the id of the hook inside the group (retrieved by <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list templates</font> with <font color="${COLOR_VALUE}">group</font> as argument).`
    );

    commands.hook.help = helpObject(
        commands.hook,
        `Adding or removing hooks in runtime for test purposes.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook</font>`
    );

    commands.scan.raw.help = helpObject(
        commands.scan.raw,
        `Scans for unknown packets.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan raw</font>`
    );

    commands.scan.verbose.help = helpObject(
        commands.scan.verbose,
        `Enables/Disables verbose mode.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan verbose</font>`
    );

    commands.list.help = helpObject(
        commands.list,
        `Lists active groups or all available groups (default).`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list</font>`
    );

    commands.list.active.help = helpObject(
        commands.list.active,
        `Lists active groups.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list active</font>`
    );

    commands.list.opcodes.help = helpObject(
        commands.list.opcodes,
        `Lists all opcodes with there corresponding names.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list opcodes</font>`
    );

    commands.list.templates.help = helpObject(
        commands.list.templates,
        `Lists all opcodes with there corresponding names.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list opcodes</font>`
    );

    commands.scan.help = helpObject(
        commands.scan,
        `Tool for enabling/disabling hooks and output messages. By default enables/disables all hooks or enables/disables a specific group of hooks by a given group name.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan</font> <font color="${COLOR_VALUE}">[group-name]</font>\nWhere <font color="${COLOR_VALUE}">[group-name]</font> is the specific name of the hook group which should be enabled/disabled.`
    );

    commands.pos.save.help = helpObject(
        commands.pos.save,
        `Saves the current position with a name.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} pos save</font> <font color="${COLOR_VALUE}">position-name</font>`
    );

    commands.pos.list.help = helpObject(
        commands.pos.list,
        `Lists all stored positions.`,
        `USAGE <font color="${COLOR_COMMAND}">${ROOT_COMMAND} pos list</font>`
    );

    commands.pos.delete.help = helpObject(
        commands.pos.delete,
        `Deletes a specified position.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} pos delete</font> <font color="${COLOR_VALUE}">position-name</font>`
    );

    commands.pos.reset.help = helpObject(
        commands.pos.reset,
        `Resets the list of stored positions.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} pos reset</font>`
    );

    commands.pos.help = helpObject(
        commands.pos,
        `A tool to store and print positions. Prints current position by default.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} pos</font>`
    );

    commands.use.help = helpObject(
        commands.use,
        `Uses an item by a specified item id.`,
        `USAGE <font color="${COLOR_COMMAND}">${ROOT_COMMAND} use</font> <font color="${COLOR_VALUE}">item-id</font>`
    );

    commands.help = helpObject(
        commands,
        `Utilities for analysing packets with filtering functionality.`,
        `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND}</font>\nUtilities for analysing packets with filtering functionality.`
    );

    // init illegalPosCommands
    for ( let command in commands.pos ) {
        illegalPosCommands.push( command );
    }

    command.add( ROOT_COMMAND, commands, commands );

    let scannedCodes;

    function rawScan() {
        scannedCodes = [];
        let result = hookManager.hook( "raw", "*", "raw", ( code, data, fromServer, fake ) => {
            if ( !scannedCodes.includes( code ) ) {
                chat.printMessage( `${code}(${typeof code}) -> ${OPCODE_MAP.get( code )}` );
                scannedCodes.push( code );
            }
        });
        let msg = "Scan raw packets ";
        if ( !result.hook ) {
            hookManager.unhookGroup( "raw" );
            msg += `<font color="${COLOR_DISABLE}">disabled</font>.`;
        } else {
            msg += `<font color="${COLOR_ENABLE}">enabled</font>.`;
        }
        chat.printMessage( msg );
    }

    function scanOpcode( opcode ) {
        let result = hookManager.hook( "raw-opcode" + opcode, "*", "raw", ( code, data, fromServer, fake ) => {
            if ( code === parseInt( opcode ) ) {
                let left = fake && fromServer ? "P" : "S";
                let arrow = fromServer ? "->" : "<-";
                let right = fake && !fromServer ? "P" : "C";
                chat.printMessage( `${left} ${arrow} ${right} ${code}` );
                if ( !logger[opcode]) {
                    logger[opcode] = bunyan.createLogger({
                        name: "opcode",
                        streams: [
                            {
                                path: path.join( OPCODES_PATH, opcode + ".log" ),
                                level: "debug"
                            }
                        ]
                    });
                }
                logger[opcode].debug({ name: OPCODE_MAP[opcode], data });
            }
        });
        let msg = "";
        if ( !result.hook ) {
            delete logger[opcode];
            hookManager.unhookGroup( "raw-opcode" + opcode );
            msg = `<font color="${COLOR_DISABLE}">Stop</font>`;
        } else {
            msg = `<font color="${COLOR_ENABLE}">Start</font>`;
        }
        chat.printMessage( `${msg} scanning for <font color="${COLOR_VALUE}">${opcode}</font>.` );
    }

    /**
     * @args groupNameParts
     * @returns true, if successful. Otherwise false.
     */
    function switchGroup( groupNameParts ) {
        if ( !groupNameParts || !groupNameParts.length ) return false;
        let groupName = "";
        if ( Array.isArray( groupNameParts ) ) {
            for ( let i = 0; i < groupNameParts.length; i++ ) {
                groupName += groupNameParts[i];
                if ( i < groupNameParts.length - 1 ) groupName += " ";
            }
        } else {
            groupName = groupNameParts;
        }
        if ( groupName == "" ) {
            chat.printMessage( "Please enter a group name." );
            chat.printMessage( this.scan.help.long() );
            return false;
        }
        if ( !hookManager.hasGroup( groupName ) ) {
            chat.printMessage( "There is no group named " + groupName );
            return false;
        }
        let isActive = hookManager.hasActiveGroup( groupName );
        if ( isActive ) hookManager.unhookGroup( groupName );
        else hookManager.hookGroup( groupName );
        chat.printMessage(
            groupName
                + ( !isActive ?
                    ` <font color="${COLOR_ENABLE}">enabled</font>.`
                    : ` <font color="${COLOR_DISABLE}">disabled</font>.` )
        );
        return true;
    }

    function switchScanning() {
        scanning = !scanning;
        if ( scanning ) startScanning();
        else stopScanning();
    }

    function switchVerbose() {
        verbose = !verbose;
        chat.printMessage(
            "Verbose mode "
                + ( verbose ? '<font color="#56B4E9">enabled</font>.' : '<font color="#E69F00">disabled</font>.' )
        );
    }

    function savePosition( name ) {
        if ( positions.has( name ) ) {
            chat.printMessage( "There is already a position saved with this name. Choose another name." );
            return false;
        }
        let pos = lastLocation.loc;
        positions.set( name, pos );
        chat.printMessage( `Position "${JSON.stringify( pos )}" saved as "${name}".` );
        return true;
    }

    function printPosition( value, key ) {
        chat.printMessage( `"${key}": ${JSON.stringify( value )}` );
    }

    function printPositions() {
        chat.printMessage( positions.size + " positions saved:" );
        positions.forEach( printPosition );
    }

    function printGroups() {
        chat.printMessage( "Available hook groups:" );
        for ( let group of hookManager.getHookTemplates().keys() ) {
            chat.printMessage( group );
        }
    }

    function printTemplates( group ) {
        if ( group ) {
            if ( !hookManager.hasGroup( group ) ) {
                chat.printMessage( `There is no such group <font color="${COLOR_VALUE}">${group}</font>.` );
            }
            chat.printMessage( `Templates of group <font color="${COLOR_HIGHLIGHT}">${group}</font>:` );
            let groupTemps = hookManager.getHookTemplates().get( group );
            for ( let i = 0; i < groupTemps.length; i++ ) {
                chat.printMessage( `${i}: ${JSON.stringify( groupTemps[i][0])}` );
            }
        } else {
            for ( let g of hookManager.getHookTemplates().keys() ) {
                printTemplates( g );
            }
        }
    }

    function printActiveGroups() {
        chat.printMessage( "Active hook groups:" );
        for ( let group of hookManager.getActiveHooks().keys() ) {
            if ( hookManager.activeHooks.get( group ).length ) {
                chat.printMessage( group );
            }
        }
    }

    function printOpcodes() {
        chat.printMessage( "Opcodes:" );
        let s = "";
        let size = OPCODE_MAP.size;
        let i = 0;
        for ( let name of OPCODE_MAP.values() ) {
            s += name;
            if ( i < size - 1 ) s += ", ";
            i++;
        }
        chat.printMessage( s );
    }

    function initGroupedOpcodeHooks() {
        for ( let item of GROUPED_OPCODE_MAP ) {
            hookManager.addTemplate( item[0], OPCODE_MAP.get( item[1]), "*", e => {
                chat.printMessage( JSON.stringify( e ) );
            });
        }
    }

    function startScanning() {
        hookManager.hookAll();
        scanning = true;
        chat.printMessage( "All hooks started." );
    }

    function stopScanning() {
        hookManager.unhookAll();
        scanning = false;
        chat.printMessage( "All hooks stopped." );
    }

    function useItem( item ) {
        chat.printMessage( `USE ITEM: ${item}` );
        mod.toServer( "C_USE_ITEM", 3, {
            gameId: gameId,
            id: item,
            dbid: 0,
            target: 0,
            amount: 1,
            dest: { x: 0, y: 0, z: 0 },
            loc: { x: 0, y: 0, z: 0 },
            w: 0,
            unk1: 0,
            unk2: 0,
            unk3: 0,
            unk4: 1
        });
    }

    function initFixHooks() {
        /*
        vec3    loc
        angle   w
        angle   lookDirection
        # Your w direction but while in an action that allows you to look around example: Gunner Blast/Arcane Barrage
        vec3    dest
        int32   type
        # 0 = running, 1 = walking, 2 = falling, 5 = jumping,
        # 6 = jump intersection and end when something is blocking the path and the player can't
        # travel in the X and Y axis(it will then wait and resume if possible)
        # 7 = stop moving, landing
        # 8 = swimming, 9 = stop swimming, 10 = falling after jumping
        int16   jumpDistance # movement speed while jumping in a direction
        bool    inShuttle
        uint32  time # Operating System uptime (ms)
        */
        hookManager.addTemplate( "movement", "C_PLAYER_LOCATION", 5, event => {
            let typeName = "";
            switch ( event.type ) {
                case 0:
                    typeName = "running";
                    break;
                case 1:
                    typeName = "walking";
                    break;
                case 2:
                    typeName = "falling";
                    break;
                case 5:
                    typeName = "jumping";
                    break;
                case 6:
                    typeName = "jumping interrupted";
                    break;
                case 7:
                    typeName = "stop moving/landing";
                    break;
                case 8:
                    typeName = "swimming";
                    break;
                case 9:
                    typeName = "stop swimming";
                    break;
                case 10:
                    typeName = "falling after jumping";
                    break;
                default:
                    typeName = "Unknown: " + event.type;
            }
            lastLocation = event;
            if ( verbose ) chat.printMessage( `${typeName} (${ChatHelper.msToUTCTimeString( event.time )}) => ${event.loc}` );
        });

        /*
        uint64 gameId
        int32  id
        uint64 dbid
        uint64 target
        int32  amount
        vec3   dest
        vec3   loc
        angle  w
        uint32 unk1
        uint32 unk2
        uint32 unk3
        bool   unk4  # true?
        */
        hookManager.addTemplate( "item", "C_USE_ITEM", 3, event => {
            chat.printMessage( ":::::USE ITEM:::::" );
            chat.printMessage( "GameId: " + event.gameId );
            chat.printMessage( "ID: " + event.id );
            chat.printMessage( "DBID: " + event.dbid );
            chat.printMessage( "Target: " + event.target );
            chat.printMessage( "Amount: " + event.amount );
            chat.printMessage( "dest: " + JSON.stringify( event.dest ) );
            chat.printMessage( "loc: " + JSON.stringify( event.loc ) );
            chat.printMessage( "angle: " + event.w );
            chat.printMessage( "unk1: " + event.unk1 );
            chat.printMessage( "unk2: " + event.unk2 );
            chat.printMessage( "unk3: " + event.unk3 );
            chat.printMessage( "unk4: " + event.unk4 );
            chat.printMessage( "::::::::::::::::::" );
        });
        //uint32 countdown # 10
        hookManager.addTemplate( "exit", "S_PREPARE_EXIT", 1, event => {
            chat.printMessage( `PREPARE EXIT countdown: ${event.countdown}s` );
        });
        //int32 time
        hookManager.addTemplate( "logout", "S_PREPARE_RETURN_TO_LOBBY", 1, event => {
            chat.printMessage( `LOGOUT time: ${event.time}` );
        });
        //# These are sent to the launcher prior to closing the game
        //int32 category
        //int32 code
        hookManager.addTemplate( "exit", "S_EXIT", 3, event => {
            chat.printMessage( `EXIT category: "${event.category}", code: "${event.code}"` );
        });

        hookManager.addTemplate( "exit", "C_EXIT", 1, e => chat.printMessage( "C_EXIT" ) );

        hookManager.addTemplate( "logout", "C_RETURN_TO_LOBBY", 1, e => chat.printMessage( "C_RETURN_TO_LOBBY" ) );
        hookManager.addTemplate( "logout", "S_RETURN_TO_LOBBY", 1, e => chat.printMessage( "S_RETURN_TO_LOBBY" ) );
        hookManager.addTemplate( "channel", "S_SELECT_CHANNEL", 1, e => chat.printMessage( "S_SELECT_CHANNEL" ) );
        // int32 seconds
        hookManager.addTemplate( "channel", "S_PREPARE_SELECT_CHANNEL", 1, e =>
            chat.printMessage( `S_SELECT_CHANNEL seconds=${e.seconds}` )
        );
        // count  channels
        // offset channels
        //
        // int32 unk
        // int32 zone
        // array channels
        // - int32 channel
        // - int32 density
        hookManager.addTemplate( "channel", "S_LIST_CHANNEL", 1, e => {
            chat.printMessage( `S_LIST_CHANNEL ${e.count} channel${e.count > 1 ? "s" : ""} in ${e.zone}. unk=${e.unk}` );
            chat.printMessage( "channel: density" );
            for ( let c of e.channels ) {
                chat.printMessage( `${c.channel}: ${c.density}` );
            }
        });
        // int32 unk
        // int32 zone
        hookManager.addTemplate( "channel", "C_LIST_CHANNEL", 1, e =>
            chat.printMessage( `C_LIST_CHANNEL in ${e.zone}. unk=${e.unk}` )
        );
        // int32 zone    # If changed, triggers the "Moving to channel X." message
        // int32 channel # ^ See above
        // int32 density # 0 = Low, 1 = Medium, 2 = High
        // int32 type    # 1 = Multiple channels with density, 2 = Cannot change channel, 3 = Hidden (single channel)
        hookManager.addTemplate( "channel", "S_CURRENT_CHANNEL", 2, e => {
            chat.printMessage( `S_CURRENT_CHANNEL ${e.channel}(ch): ${e.density}(density) in ${e.zone}. unk=${e.unk}` );
            switch ( e.type ) {
                case 1:
                    chat.printMessage( "Multiple channels with density" );
                    break;
                case 2:
                    chat.printMessage( "Cannot change channel" );
                    break;
                case 3:
                    chat.printMessage( "Hidden (single channel)" );
                    break;
                default:
                    chat.printMessage( `Unknown type: ${e.type}` );
            }
        });
        // int32 unk
        // int32 zone
        // int32 channel
        hookManager.addTemplate( "channel", "C_SELECT_CHANNEL", 1, e => {
            chat.printMessage( `C_SELECT_CHANNEL ${e.channel}(ch) in ${e.zone}. unk=${e.unk}` );
        });
        // byte unk # 0-1, not sure what it means
        hookManager.addTemplate( "channel", "S_CANCEL_SELECT_CHANNEL", 1, e => {
            chat.printMessage( `S_CANCEL_SELECT_CHANNEL unk=${e.unk}` );
        });
        hookManager.addTemplate( "channel", "C_CANCEL_SELECT_CHANNEL", 1, e => {
            chat.printMessage( `C_CANCEL_SELECT_CHANNEL` );
        });

        /*
        # elite bar?
        count inventory
        offset inventory

        int32 size

        array inventory
        - int32 slot
        - int32 type # 1 = item, 2 = skill
        - int32 skill
        - int32 item
        - int32 amount
        - int32 cooldown
        */
        hookManager.addTemplate( "elite-bar", "S_PCBANGINVENTORY_DATALIST", 1, event => {
            let s = "Elite bar:\n[";
            for ( let item of event.inventory ) {
                s += item.slot;
                switch ( item.type ) {
                    case 1:
                        s += `# item: ${item.item}`;
                        break;
                    case 2:
                        s += `# skill: ${item.skill}`;
                        break;
                    default:
                        s += `# unknown (${item.type})`;
                }
                s += ` (count: ${item.amount}, cd: ${item.cooldown})\n`;
            }
            s += "]";
            chat.printMessage( s );
        });

        /* int32 slot */
        hookManager.addTemplate( "elite-bar", "C_PCBANGINVENTORY_USE_SLOT", 1, event => {
            chat.printMessage( "Use elite-bar slot " + event.slot );
        });

        /*
        int32 set
        array inventory
        - int32 slot
        - int32 type # 1 = item, 2 = skill
        - int32 skill
        - int32 item
        - int64 cooldown
        */
        hookManager.addTemplate( "premium", "S_PREMIUM_SLOT_DATALIST", 1, event => {
            let s = "Premium bar:\n[";
            for ( let item of event.inventory ) {
                s += item.slot;
                switch ( item.type ) {
                    case 1:
                        s += `# item: ${item.item}`;
                        break;
                    case 2:
                        s += `# skill: ${item.skill}`;
                        break;
                    default:
                        s += `# unknown (${item.type})`;
                }
                s += ` (cd: ${item.cooldown})\n`;
            }
            s += "]";
            chat.printMessage( s );
        });

        /*
        int32 set
        int32 slot
        int32 type
        int32 skill
        int32 item
        */
        hookManager.addTemplate( "premium", "C_PREMIUM_SLOT_USE_SLOT", 1, event => {
            let s = `Use premium bar slot ${event.slot} (set:${event.set})`;
            switch ( event.type ) {
                case 1:
                    s += `# item: ${event.item}`;
                    break;
                case 2:
                    s += `# skill: ${event.skill}`;
                    break;
                default:
                    s += `# unknown (${event.type})`;
            }
            chat.printMessage( s );
        });
        /*
        # majorPatchVersion >= 75

        uint64 target
        uint64 source
        uint32 id
        int32 duration
        int32 unk
        int32 stacks
        int32 unk2
        int32 unk3 # 0? new
        */
        hookManager.addTemplate( "buff", "S_ABNORMALITY_BEGIN", 3, e => {
            if ( mod.game.me.is( e.target ) )
                chat.printMessage(
                    `Buff start: ${e.id} (dur:${e.duration}, stacks:${e.stacks},${e.source}->${e.target})`
                );
        });

        /*
        uint64 target
        uint32 id
        int32  duration
        int32  unk
        int32  stacks
        */
        hookManager.addTemplate( "buff", "S_ABNORMALITY_REFRESH", 1, e => {
            if ( mod.game.me.is( e.target ) )
                chat.printMessage( `Buff refresh: ${e.id} (dur:${e.duration}, stacks:${e.stacks},->${e.target})` );
        });

        /*
        uint64 target
        uint32 id
        */
        hookManager.addTemplate( "buff", "S_ABNORMALITY_END", 1, e => {
            if ( mod.game.me.is( e.target ) ) chat.printMessage( `Buff end: ${e.id} (->${e.target})` );
        });

        /*
        uint64 target
        uint32 id
        byte unk1
        byte unk2
        byte unk3
        */
        hookManager.addTemplate( "buff", "S_ABNORMALITY_FAIL", 1, e => {
            if ( mod.game.me.is( e.target ) )
                chat.printMessage( `Buff end: ${e.id} (->${e.target},unk1:${e.unk1},unk2:${e.unk2},unk3:${e.unk3})` );
        });
        /*
        offset authorName
        offset message

        uint32 channel # see cChat.def
        uint64 authorID
        byte   unk1
        byte   gm
        byte   founder # CBT User. Early access set.
        string authorName
        string message
        */
        hookManager.addTemplate( "chat", "S_CHAT", 2, e => {
            chat.printMessage( e.message );
        });
        /*
        offset authorName
        offset recipient
        offset message

        uint64 player
        byte   unk1
        byte   gm
        byte   founder # CBT User. Early access set.
        string authorName
        string recipient
        string message
        */
        hookManager.addTemplate( "chat", "S_WHISPER", 2, e => {
            chat.printMessage( e.message );
        });
        /*
        offset authorName
        offset message

        uint32 channel # globally unique id generated by the server
        uint64 authorID
        string authorName
        string message
        */
        hookManager.addTemplate( "chat", "S_PRIVATE_CHAT", 1, e => {
            chat.printMessage( e.message );
        });

        /*
        offset name
        offset message

        int32  id
        byte   unk
        byte   raid
        int32  unk2 #always 65? Possibly level limit
        string name
        string message
        */
        hookManager.addTemplate( "chat", "S_PARTY_MATCH_LINK", 1, e => {
            chat.printMessage( e.name + " " + e.message );
        });

        /*
        count  version
        offset version

        array  version
        - int32 index
        - int32 value
        */
        hookManager.addTemplate( "version", "C_CHECK_VERSION", 1, e => {
            chat.printMessage( "Versions:" );
            for ( let v of e.version ) {
                chat.printMessage( `<font color="${COLOR_VALUE}">${JSON.stringify( v )}</font>` );
            }
        });
        /* byte ok */
        hookManager.addTemplate( "version", "S_CHECK_VERSION", 1, e => {
            chat.printMessage( `Version answer: <font color="${COLOR_VALUE}">${e.ok}</font>` );
        });

        /* int32 id */
        hookManager.addTemplate( "daily", "C_COMPLETE_DAILY_EVENT", 1, e => {
            chat.printMessage( `Returned: ${e.id}.` );
        });

        /* int32 id */
        hookManager.addTemplate( "daily", "S_COMPLETE_EVENT_MATCHING_QUEST", 1, e => {
            chat.printMessage( `Completed: ${e.id}.` );
        });
        /*
        int32 expDifference
        uint64 exp
        uint32 level
        uint32 dailyExp
        uint32 dailyExpMax
        bool levelUp
        uint32 totalPoints
        float baseRev
        float tsRev
         */
        hookManager.addTemplate( "player-ep", "S_PLAYER_CHANGE_EP", 1, e => {
            let messages = [];
            messages.push( `LVL: <font color="${COLOR_VALUE}">${e.level}</font>${e.levelUp ? " (Level UP!)" : ""}` );
            messages.push( `EP: <font color="${COLOR_VALUE}">${e.totalPoints}</font>` );
            messages.push(
                `XP gained: <font color="${COLOR_VALUE}">${e.expDifference}</font> (<font color="${COLOR_VALUE}">${
                    e.baseRev
                }</font>, TS=<font color="${COLOR_VALUE}">${e.tsRev}</font>)`
            );
            messages.push(
                `XP: <font color="${COLOR_VALUE}">${e.exp
                    - BigInt( e.dailyExp )}</font> ==( <font color="${COLOR_VALUE}">${Math.floor(
                    e.dailyExpMax * SOFT_CAP_MOD_START
                )}</font> [<font color="${COLOR_VALUE}">${e.dailyExpMax}</font>] - <font color="${COLOR_VALUE}">${
                    e.dailyExp
                }</font> = <font color="${COLOR_VALUE}">${Math.floor( e.dailyExpMax * SOFT_CAP_MOD_START )
                    - e.dailyExp}</font> [<font color="${COLOR_VALUE}">${e.dailyExpMax
                    - e.dailyExp}</font>] )==> <font color="${COLOR_VALUE}">${e.exp}</font>`
            );
            messages.map( x => {
                chat.printMessage( x );
            });
        });

        hookManager.addTemplate( "player-ep-log", "S_PLAYER_CHANGE_EP", 1, e => {
            logData( `${mod.game.me.serverId}-${mod.game.me.name}-ep`, e );
        });
        // int32 totalPoints
        // int32 gainedPoints
        hookManager.addTemplate( "player-ep", "S_CHANGE_EP_POINT", 1, e => {
            msg.clear();
            msg.text( "EP: " )
                .color( COLOR_VALUE )
                .text( e.totalPoints );
            msg.color().text( "Gained?: " );
            msg.color( COLOR_VALUE ).text( e.gainedPoints );
            if ( verbose ) chat.printMessage( msg.toHtml() );
        });

        /*
        uint32 level
        uint64 exp
        uint32 totalPoints
        uint32 usedPoints
        uint32 dailyExp
        uint32 dailyExpMax
        uint32 prevLevel
        uint32 prevTotalPoints
        array perks
        - uint32 id
        - uint32 level
         */
        hookManager.addTemplate( "player-ep", "S_LOAD_EP_INFO", 1, e => {
            let messages = [];
            messages.push( `EP-INFO:` );
            messages.push( `LVL: <font color="${COLOR_VALUE}">${e.level}</font>` );
            messages.push(
                `EP: <font color="${COLOR_VALUE}">${e.usedPoints}</font>/<font color="${COLOR_VALUE}">${
                    e.totalPoints
                }</font> (left: <font color="${COLOR_VALUE}">${e.totalPoints - e.usedPoints}</font>)`
            );
            messages.push(
                `XP: <font color="${COLOR_VALUE}">${e.exp
                    - BigInt( e.dailyExp )}</font> ==(<font color="${COLOR_VALUE}">${Math.floor(
                    e.dailyExpMax * SOFT_CAP_MOD_START
                )}</font>[<font color="${COLOR_VALUE}">${e.dailyExpMax}</font>]-<font color="${COLOR_VALUE}">${
                    e.dailyExp
                }</font>=<font color="${COLOR_VALUE}">${Math.floor( e.dailyExpMax * SOFT_CAP_MOD_START )
                    - e.dailyExp}</font>[<font color="${COLOR_VALUE}">${e.dailyExpMax
                    - e.dailyExp}</font>] )==> <font color="${COLOR_VALUE}">${e.exp}</font>`
            );
            // msg.push(`Perks:`);
            // for(let p of e.perks) {
            //     msg.push(`<font color="${COLOR_VALUE}">${p.id}</font>: <font color="${COLOR_VALUE}">${p.level}</font>`);
            // }
            messages.map( x => {
                chat.printMessage( x );
            });
        });

        hookManager.addTemplate( "player-ep-log", "S_LOAD_EP_INFO", 1, e => {
            logData( `${mod.game.me.serverId}-${mod.game.me.name}-ep`, e );
        });

        // ?
        hookManager.addTemplate( "player-ep", "S_SHOW_USER_EP_INFO", 1, e => {
            let msg = `Show user EP-INFO.`;
            // logger["player"].debug(ChatHelper.cleanString(msg));
            chat.printMessage( msg );
        });

        // int32 limit
        hookManager.addTemplate( "player-ep", "S_CHANGE_EP_EXP_DAILY_LIMIT", 1, e => {
            let msg = `Change Daily limit to <font color="${COLOR_VALUE}">${e.limit}</font>`;
            // logger["player"].debug(ChatHelper.cleanString(msg));
            chat.printMessage( msg );
        });
    }

    function logData( logName, data ) {
        if ( !logger[logName]) {
            logger[logName] = bunyan.createLogger({
                name: logName,
                streams: [
                    {
                        path: path.join( GENERAL_LOG_PATH, `${logName}.log` ),
                        level: "debug"
                    }
                ]
            });
        }
        let serializedData = serializeData( data );
        logger[logName].debug({ data: serializedData, localeTime: new Date().toLocaleTimeString() });
    }

    function serializeData( data ) {
        let serializedData = {};
        for ( let p in data ) {
            if ( typeof data[p] === "object" ) serializedData[p] = serializeData( data[p]);
            else if ( typeof data[p] === "bigint" ) serializedData[p] = data[p].toString();
            else {
                serializedData[p] = JSON.stringify( data[p]);
            }
        }
        return serializedData;
    }

    function logStringArray( logName, messages ) {
        if ( !logger[logName]) {
            logger[logName] = bunyan.createLogger({
                name: logName,
                streams: [
                    {
                        path: path.join( GENERAL_LOG_PATH, `${logName}.log` ),
                        level: "debug"
                    }
                ]
            });
        }
        messages = messages.map( x => ChatHelper.cleanString( x ) );
        logger[logName].debug( messages.join( ";" ) );
    }
};
