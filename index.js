const bunyan = require( "bunyan" );
const path = require( "path" );
const fs = require( "fs" );
const util = require( "util" );
const PacketAnalyser = require( "./packet-analyser" );
// const SimpleLogManager = require( "simple-node-logger" ).createLogManager();

const COLOR_ENABLE = "#56B4E9";
const COLOR_DISABLE = "#e64500";
const COLOR_COMMAND = "#e6a321";
const COLOR_VALUE = "#09d1d1";
const COLOR_HIGHLIGHT = "#81ee7b";
const SOFT_CAP_MOD_START = 0.88945;
const SOFT_CAP_MOD_END = SOFT_CAP_MOD_START + 0.2;
const ROOT_COMMAND = "util";
const POSITIONS_FILE_NAME = "positions.json";
const POSITIONS_PATH = path.resolve( __dirname, POSITIONS_FILE_NAME );
const OPCODES_PATH = path.join( __dirname, "opcodes" );
const GENERAL_LOG_PATH = path.join( __dirname, "logs" );
const TEMPLATES_PATH = path.join( __dirname, "templates.json" );

const ANALYSED_LENGTH_SHORT = 4;
const BUFFER_LENGTH_SHORT = 16;
const BUFFER_LENGTH_LONG = 512;
const FORMAT_OPTIONS_SHORT = { colors: false, breakLength: 120, maxArrayLength: BUFFER_LENGTH_SHORT };
const FORMAT_OPTIONS_COMMON = { colors: false, breakLength: 120 };
const FORMAT_OPTIONS_LONG = { colors: false, breakLength: 120, maxArrayLength: BUFFER_LENGTH_LONG };

let HookManager;
let MessageBuilder;
let ChatHelper;
let FileHelper;
let hookManager;
let msg;
let chat;
let scanning = false;
let dynamicTemplates;
let positions;

function utilityBox( mod ) {
    //mod.game.initialize(["me", "contract"]);
    const command = mod.command;
    const logger = {};
    // const simpleLogger = {};
    if ( !fs.existsSync( OPCODES_PATH ) ) fs.mkdirSync( OPCODES_PATH );
    if ( !fs.existsSync( GENERAL_LOG_PATH ) ) fs.mkdirSync( GENERAL_LOG_PATH );

    let gameId = null,
        lastLocation = null,
        verbose = false;
    let analyser = {};
    // chat.printMessage( "Version: " + version, true );
    const POSITIONS_DATA = FileHelper.loadJson( POSITIONS_PATH );
    if ( Array.isArray( POSITIONS_DATA ) ) {
        positions = new Map( POSITIONS_DATA );
    } else {
        positions = new Map();
    }
    const TEMPLATES_DATA = FileHelper.loadJson( TEMPLATES_PATH );
    if ( Array.isArray( TEMPLATES_DATA ) ) {
        dynamicTemplates = TEMPLATES_DATA;
        for ( let template of TEMPLATES_DATA ) {
            try {
                hookManager.addTemplate(
                    template.group,
                    template.def,
                    template.version,
                    generateFunction( template.vars )
                );
            } catch ( err ) {
                mod.log( `Could not read template: ${err}` );
            }
        }
    } else {
        dynamicTemplates = [];
    }
    // const OPCODE_JSON = "opcodes.json";
    // const GROUPED_OPCODE_JSON = "groups.json";
    let OPCODE_FILE_NAME, OPCODE_NAME_MAP, GROUPED_OPCODE_MAP, NAME_OPCODE_MAP, LATEST_VERSION_MAP;
    //
    // OPCODE_FILE_NAME = `../../node_modules/tera-data/map_base/protocol.${version}.map`;
    OPCODE_NAME_MAP = mod.dispatch.protocolMap.code; // opcode -> name
    NAME_OPCODE_MAP = mod.dispatch.protocolMap.name;
    LATEST_VERSION_MAP = mod.dispatch.latestDefVersion;
    GROUPED_OPCODE_MAP = FileHelper.groupOpcodes( OPCODE_NAME_MAP ); // group (S,C,DBS,...) -> opcode

    // saveJsonData(OPCODE_JSON, Array.from(OPCODE_MAP));
    // saveJsonData(GROUPED_OPCODE_JSON, Array.from(GROUPED_OPCODE_MAP));

    initGroupedOpcodeHooks();
    initFixHooks();

    hookManager.hookGroup( "positioning" );
    hookManager.hookGroup( "player-ep-log" );

    mod.game.on( "enter_game", () => {
        gameId = mod.game.me.gameId;
    });

    // mod.game.on( 'leave_game', () => {
    // } );

    // mod.game.contract.on( "begin", ( e ) => {
    //     chat.printMessage( `Begin Contract: <font color="${COLOR_VALUE}">${util.inspect( e )}</font>` );
    // });
    //
    // mod.game.contract.on( "end", ( e ) => {
    //     chat.printMessage( `End Contract: <font color="${COLOR_VALUE}">${util.inspect( e )}</font>` );
    // });

    let illegalPosCommands = [];

    function generateFunction( vars ) {
        // e is used in eval
        return e => {
            for ( let v of vars ) {
                let value = eval( "e." + v );
                if ( typeof value == "bigint" ) value = value.toString();
                if ( Array.isArray( value ) ) {
                    chat.printMessage( v + " = " );
                    for ( let element of value ) {
                        chat.printMessage( JSON.stringify( element ) );
                    }
                } else {
                    chat.printMessage( v + " = " + JSON.stringify( value ) );
                }
            }
        };
    }

    function isNumber( string ) {
        return /[0-9]+/.test( string );
    }

    function isVersion( string ) {
        return /raw|\*|[0-9]+/.test( string );
    }

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
                $default: function( group, def, version, ...vars ) {
                    if ( arguments.length < 4 ) return printHelpList( this.help.hook.add );
                    let isNum = isNumber( version );
                    let isCorrectVersion = isVersion( version );
                    if ( typeof version == "string" && !( isNum || isCorrectVersion ) ) {
                        return chat.printMessage(
                            `Illegal version "<font color "${COLOR_HIGHLIGHT}">${version}</font>". Should be "<font color "${COLOR_HIGHLIGHT}">*</font>", "<font color "${COLOR_HIGHLIGHT}">raw</font>" or a positive integer number <font color "${COLOR_HIGHLIGHT}">0,1,2,...</font>.`
                        );
                    }
                    if ( !NAME_OPCODE_MAP.has( def ) ) {
                        return chat.printMessage(
                            `There is no hook named "<font color="${COLOR_HIGHLIGHT}">${def}</font>".`
                        );
                    }
                    chat.printMessage(
                        `Successfully added hook to group:${group}, name: ${def}, version: ${version}, vars: ${JSON.stringify(
                            vars
                        )}`
                    );
                    if ( isNumber ) version = parseInt( version );
                    let result = hookManager.addTemplate( group, def, version, generateFunction( vars ) );

                    if ( !result.group ) {
                        chat.printMessage( "Hook does already exist." );
                    } else {
                        dynamicTemplates.push({ group: group, def: def, version: version, vars: vars });
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
                    if ( !name ) printHelpList( this.help.hook.remove );
                    if ( hookManager.removeTemplateByName( name, group ) ) {
                        chat.printMessage(
                            `Template named <font color="${COLOR_VALUE}">${name}</font> ${
                                group ? `in <font color="${COLOR_VALUE}">${group}</font> ` : ""
                            }successfully removed.`
                        );
                    }
                }
            },
            $default() {
                printHelpList( this.help.hook );
            }
        },
        analyse: {
            start: function() {
                msg.clear();
                if ( checkAnalyzer() ) {
                    listTypes();
                }
            },
            choose: function( type ) {
                msg.clear();
                if ( checkAnalyzer() ) {
                    try {
                        msg.text( "You have chosen:\n" );
                        let data = analyser[analyser.default].choose( type );
                        msg.value( util.formatWithOptions( FORMAT_OPTIONS_SHORT, data ) );
                        msg.color().text( ".\nPacket so far: " );
                        let analysedPacket = analyser[analyser.default].analysedPacket;
                        msg.value( util.formatWithOptions( FORMAT_OPTIONS_SHORT, analysedPacket ) );
                        msg.color().text( " (" );
                        msg.highlight( analyser[analyser.default].selectedPosition );
                        msg.color().text( ")" );
                        chat.printMessage( msg.toHtml() );
                        listTypes();
                    } catch ( error ) {
                        chat.printMessage( error );
                    }
                }
            },
            undo: function() {
                msg.clear();
                if ( checkAnalyzer() ) {
                    let success = analyser[analyser.default].undo();
                    if ( !success ) msg.text( "Nothing to undo." );
                    msg.text( "Buffer: " );
                    let curBuffer = analyser[analyser.default].currentBufferSegment;
                    msg.value( util.formatWithOptions( FORMAT_OPTIONS_SHORT, curBuffer ) );
                    chat.printMessage( msg.toHtml() );
                }
            },
            redo: function() {
                msg.clear();
                if ( checkAnalyzer() ) {
                    let success = analyser[analyser.default].redo();
                    if ( !success ) msg.text( "Nothing to redo." );
                    msg.text( "Buffer: " );
                    let curBuffer = analyser[analyser.default].currentBufferSegment;
                    msg.value( util.formatWithOptions( FORMAT_OPTIONS_SHORT, curBuffer ) );
                    chat.printMessage( msg.toHtml() );
                }
            },
            select: function( opcode ) {
                msg.clear();
                if ( !analyser[analyser.default]) {
                    msg.text( "Analyser has not been started, yet. Use " );
                    msg.command( ROOT_COMMAND + " analyse " ).value( "opcode" );
                    msg.color().text( " to start the Analyser. Where...\n" );
                    msg.value( "opcode " ).color();
                    msg.text( "is the opcode number of the packet that should be analysed." );
                    chat.printMessage( msg.toHtml() );
                } else {
                    if ( !checkOpcode( opcode ) ) return;
                    msg.clear();
                    analyser.default = parseInt( opcode );
                    msg.value( opcode ).color();
                    msg.text( " selected for analysing." );
                    chat.printMessage( msg.toHtml() );
                }
            },
            $default: analyseOpcode
        },
        scan: {
            raw: {
                $default: function( name, ...opcodes ) {
                    if ( arguments.length == 0 || ( !name && opcodes[0] == undefined ) ) rawScan();
                    else if ( arguments.length < 2 && !Number.isInteger( parseInt( name ) ) )
                        return printHelpList( this.help.scan.raw );
                    else scanOpcode( name, ...opcodes );
                }
            },
            def: {
                $default: function( name, ...defs ) {
                    if( arguments.length < 2 ) return printHelpList( this.help.scan.def );
                    else scanDef( name, ... defs );
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
                    if ( !nameParts || !nameParts.length ) return printHelpList( this.help.pos.save );
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
                    if ( !nameParts || !nameParts.length ) return printHelpList( this.help.pos.delete );
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
                    if ( !hookManager.hasActiveGroup( "positioning" ) ) switchGroup( "positioning" );
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
        help: {
            long() {
                msg.clear();
                msg.text( "USAGE: " );
                msg.command( ROOT_COMMAND );
                msg.color().text( "\nA utility box for mod programmer. (experimental)" );
                msg.text( "You may get position ingame, scanning for opcodes, creating hooks ingame and more." );
                msg.text( `For more help use "${ROOT_COMMAND} help [subcommand]". Subcommands are listed below.` );
                return msg.toHtml();
            },
            short() {
                return `The Utility Box: Utilities for analysing packets with filtering functionality.`;
            },
            hook: {
                long() {
                    return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook</font>`;
                },
                short() {
                    return `Adding or removing hooks in runtime for test purposes.`;
                },
                $default() {
                    printHelpList( this.help.hook );
                },
                add: {
                    $default() {
                        printHelpList( this.help.hook.add );
                    },
                    short() {
                        return `Adds a hook template that can be activated with "scan".`;
                    },
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook add</font> <font color="${COLOR_VALUE}">group hook-name version variables</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group the hook should be assigned to.\n<font color="${COLOR_VALUE}">hook-name</font> is the name of the hook packet such as "S_CHAT".\n<font color="${COLOR_VALUE}">version</font> is the version of the packet. Should be an integer. Can also be "*" for the latest version or "raw" to create a raw hook.\n<font color="${COLOR_VALUE}">vars</font> are the variables of the packet that should be printed. Each variable name is seperated by a whitespace. There should be at least 1 variable.`;
                    }
                },
                remove: {
                    $default() {
                        printHelpList( this.help.hook.remove );
                    },
                    short() {
                        return `Removes all hook templates with the specified hook name.`;
                    },
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook remove</font> <font color="${COLOR_VALUE}">hook-name group</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group that contains the hook. (optional)\n<font color="${COLOR_VALUE}">hook-name</font> is the name of the hook packet such as "S_CHAT".`;
                    },
                    id: {
                        $default() {
                            printHelpList( this.help.hook.remove.id );
                        },
                        short() {
                            return `Removes a hook template by using the id.`;
                        },
                        long() {
                            return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} hook remove id</font> <font color="${COLOR_VALUE}">group id</font>\nWhere...\n<font color="${COLOR_VALUE}">group</font> is the name of the group the hook should be assigned to.\n<font color="${COLOR_VALUE}">id</font> is the id of the hook inside the group (retrieved by <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list templates</font> with <font color="${COLOR_VALUE}">group</font> as argument).`;
                        },
                    }
                },
            },
            scan: {
                long() {
                    return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan</font> <font color="${COLOR_VALUE}">[group-name]</font>\nWhere <font color="${COLOR_VALUE}">[group-name]</font> is the specific name of the hook group which should be enabled/disabled.`;
                },
                short() {
                    return `Tool for enabling/disabling hooks and output messages. By default enables/disables all hooks or enables/disables a specific group of hooks by a given group name.`;
                },
                $default() {
                    printHelpList( this.help.scan );
                },
                raw: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan raw</font> <font color="${COLOR_VALUE}">[name-of-scan] opcode-1 opcode-2 ...</font>`;
                    },
                    short() {
                        return `Scans for unknown and known packets once.`;
                    },
                    $default() {
                        printHelpList( this.help.scan.raw );
                    },
                },
                def: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan def</font> <font color="${COLOR_VALUE}">name def-1 def-2 ...</font>`;
                    },
                    short() {
                        return `Scans for known packets with definition name.`;
                    },
                    $default() {
                        printHelpList( this.help.scan.def );
                    },
                },
                verbose: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} scan verbose</font>`;
                    },
                    short() {
                        return `Enables/Disables verbose mode.`;
                    },
                    $default() {
                        printHelpList( this.help.scan.verbose );
                    },
                },
            },
            list: {
                long() {
                    return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list</font>`;
                },
                short() {
                    return `Lists active groups, opcodes, templates or all available groups (default).`;
                },
                $default() {
                    printHelpList( this.help.list );
                },
                active: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list active</font>`;
                    },
                    short() {
                        return `Lists active groups.`;
                    },
                    $default() {
                        printHelpList( this.help.list.active );
                    }
                },
                opcodes: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list opcodes</font>`;
                    },
                    short() {
                        return `Lists all opcodes with their corresponding names.`;
                    },
                    $default() {
                        printHelpList( this.help.list.opcodes );
                    }
                },
                templates: {
                    long() {
                        return `USAGE: <font color="${COLOR_COMMAND}">${ROOT_COMMAND} list templates</font>`;
                    },
                    short() {
                        return `Lists all templates with their corresponding names.`;
                    },
                    $default() {
                        printHelpList( this.help.list.templates );
                    }
                }
            },
            analyse: {
                long() {
                    msg.clear();
                    msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse ` );
                    msg.value( "opcode" ).color();
                    msg.text( "Where...\n" ).value( "opcode" );
                    msg.color().text( ` is the opcode of the packet that should be analysed` );
                    return msg.toHtml( true );
                },
                short() {
                    return `Start/Stop scanning an packet by a given opcode that should be analysed. If no argument is given, it will output the list of currently analysing opcodes.`;
                },
                $default() {
                    printHelpList( this.help.analyse );
                },
                start: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse start` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Trys out all types (except array and object - not yet implemented) and outputs it's values.`;
                    },
                    $default() {
                        printHelpList( this.help.analyse.start );
                    },
                },
                choose: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse choose` );
                        msg.value( "type" ).color();
                        msg.text( "Where...\n" ).value( "type" );
                        msg.color().text( ` is one of the types listed above by this command or by "${ROOT_COMMAND} analyse start"` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Choose the type for the current analysing packet.`;
                    },
                    $default() {
                        printHelpList( this.help.analyse.choose );
                    },
                },
                undo: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse undo` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Reverts the last chosen type.`;
                    },
                    $default() {
                        printHelpList( this.help.analyse.undo );
                    },
                },
                redo: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse redo` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Restores the last revert done by "${ROOT_COMMAND} analyse undo".`;
                    },
                    $default() {
                        printHelpList( this.help.analyse.redo );
                    },
                },
                select: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} analyse select` );
                        msg.value( "opcode" ).color();
                        msg.text( "Where...\n" ).value( "opcode" );
                        msg.color().text( ` is the opcode of the packet that should be selected as "currently analysing"` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Restores the last revert done by "${ROOT_COMMAND} analyse undo".`;
                    },
                    $default() {
                        printHelpList( this.help.analyse.select );
                    },
                },
            },
            pos: {
                long() {
                    msg.clear();
                    msg.text( "USAGE: " ).command( `${ROOT_COMMAND} pos` );
                    return msg.toHtml( true );
                },
                short() {
                    return `A tool to store and print positions. Prints current position by default.`;
                },
                $default() {
                    printHelpList( this.help.pos );
                },
                save: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} pos save ` );
                        msg.value( "position-name" );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Saves the current position with a name.`;
                    },
                    $default() {
                        printHelpList( this.help.pos.save );
                    },
                },
                list: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} pos list ` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Lists all stored positions.`;
                    },
                    $default() {
                        printHelpList( this.help.pos.list );
                    },
                },
                delete: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} pos delete ` );
                        msg.value( "position-name" );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Deletes a specified position.`;
                    },
                    $default() {
                        printHelpList( this.help.pos.delete );
                    },
                },
                reset: {
                    long() {
                        msg.clear();
                        msg.text( "USAGE: " ).command( `${ROOT_COMMAND} pos reset ` );
                        return msg.toHtml( true );
                    },
                    short() {
                        return `Resets the list of stored positions.`;
                    },
                    $default() {
                        printHelpList( this.help.pos.reset );
                    },
                },
            },
            use: {
                long() {
                    msg.clear();
                    msg.text( "USAGE: " ).command( `${ROOT_COMMAND} use ` );
                    msg.value( "item-id" );
                    return msg.toHtml( true );
                },
                short() {
                    return `Uses an item by a specified item id.`;
                },
                $default() {
                    printHelpList( this.help.use );
                },
            },
            $default() {
                printHelpList( this.help );
            }
        },
        $default( value ) {
            if ( value == undefined || value == "" ) printHelpList( this.help );
            else {
                msg.clear();
                msg.text( `Unknown command. Type "${ROOT_COMMAND} help" for help.` );
                chat.printMessage( msg.toHtml() );
            }
        }
    };

    function printHelpList( cmds = commands.help ) {
        chat.printMessage( cmds.long() );
        let keys = Object.keys( cmds );
        let ignoredKeys = ["$default", "short", "long"];
        if ( keys.length <= ignoredKeys.length ) return;
        chat.printMessage( "subcommands:" );
        for ( let c of keys ) {
            if ( !ignoredKeys.includes( c ) ) {
                chat.printMessage( `<font color="${chat.COLOR_HIGHLIGHT}">${c}</font>  -  ${cmds[c].short()}` );
            }
        }
    }

    //init illegalPosCommands
    for ( let command in commands.pos ) {
        illegalPosCommands.push( command );
    }

    command.add( ROOT_COMMAND, commands, commands );

    function listTypes() {
        msg.clear();
        if ( analyser[analyser.default].isFinished() ) {
            chat.printMessage( "Analysing finished:" );
            msg.text( "Packet:\n" );
            msg.value( util.formatWithOptions( FORMAT_OPTIONS_LONG, analyser[analyser.default].analysedPacket ) );
            chat.printMessage( msg.toHtml() );
        } else {
            msg.text( "Choose one of these types (by using " );
            msg.command( ROOT_COMMAND + " analyse choose " ).value( "type" );
            msg.color().text( " where type is one of the types listed below):" );
            chat.printMessage( msg.toHtml() );
            msg.clear();
            msg.text( "Current Position: " ).value( analyser[analyser.default].selectedPosition );
            msg.color().text( "\nCurrent buffer segment:\n" );
            let curBuffer = analyser[analyser.default].currentBufferSegment;
            msg.value( util.formatWithOptions( FORMAT_OPTIONS_SHORT, curBuffer ) );
            let data = analyser[analyser.default].tryAll();
            data.map( x => {
                msg.text( "\n" ).highlight( `${x.type}: `.padEnd( 16, " " ) );
                msg.value( util.formatWithOptions( FORMAT_OPTIONS_COMMON, x.value ) );
                msg.color().text( `(${x.length})` );
            });
            chat.printMessage( msg.toHtml() );
        }
    }

    function checkAnalyzer() {
        if ( !analyser[analyser.default]) {
            msg.text( "Analyser has not been started, yet. Use " );
            msg.command( ROOT_COMMAND + " analyse " ).value( "opcode" );
            msg.color().text( " to start the Analyser. Where...\n" );
            msg.value( "opcode " ).color();
            msg.text( "is the opcode number of the packet that should be analysed." );
            chat.printMessage( msg.toHtml() );
            return false;
        }
        return true;
    }

    function checkOpcode( opcode ) {
        msg.clear();
        if ( opcode == undefined ) {
            msg.text( "Missing argument: " ).highlight( "opcode" );
            msg.color().text( "." );
            chat.printMessage( msg.toHtml() );
            return false;
        }
        if ( !Number.isInteger( parseInt( opcode ) ) ) {
            msg.text( 'Argument "' ).highlight( "opcode" );
            msg.color().text( '" must be a number and an integer. But was ' );
            msg.value( typeof opcode ).color();
            msg.text( ` and ${Number.isInteger( opcode ) ? "an" : "no"} integer.` );
            chat.printMessage( msg.toHtml() );
            return false;
        }
        return true;
    }

    function analyseOpcode( opcode ) {
        if ( opcode == undefined )
            return chat.printMessage(
                util.formatWithOptions( Object.keys( analyser ).map( x => ( x == "default" ? "selected: " + x.default : x ) ) )
            );
        if ( !checkOpcode( opcode ) ) return;
        let groupName = "analyse-" + opcode;
        msg.clear();
        let result = hookManager.hook( groupName, "*", "raw", ( code, data, fromServer, fake ) => {
            if ( parseInt( opcode ) == code && !analyser[code]) {
                analyser[code] = new PacketAnalyser( data, code );
                chat.printMessage( "Data recieved. Ready for analysing!" );
                let msg = new MessageBuilder();
                msg.disable( "Stop " );
                msg.color().text( groupName );
                chat.printMessage( msg.toHtml() );
                hookManager.unhookGroup( groupName );
            }
        });
        if ( !result.hook ) {
            delete analyser[opcode];
            msg.disable( "Stop" );
        } else {
            analyser[opcode] = undefined;
            analyser.default = opcode;
            msg.enable( "Start" );
        }
        msg.color().text( " scanning for " );
        msg.text( groupName );
        if ( result.hook ) msg.text( "\nWaiting for data packet received..." );
        chat.printMessage( msg.toHtml() );
    }

    let scannedCodes;

    function rawScan() {
        scannedCodes = [];
        let result = hookManager.hook( "raw", "*", "raw", ( code, data, fromServer, fake ) => {
            if ( !scannedCodes.includes( code ) ) {
                let name = OPCODE_NAME_MAP.get( code );
                let version = LATEST_VERSION_MAP.get( name );
                chat.printMessage( `${code} -> ${name} ${version?`[v${version}]`:""}` );
                if ( name != undefined ) {
                    try {
                        let eventData = mod.dispatch.protocol.parse(
                            mod.dispatch.protocol.resolveIdentifier( name , version ? version : "*" ),
                            data
                        );
                        if( verbose ) chat.printMessage( `data: ${util.inspect( eventData )}` );
                    } catch ( err ) {
                        if( verbose ) chat.printMessage( `data: ${err}` );
                    }
                }
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

    function scanDef( scanName, ...defs ) {
        if( scanName == undefined ) throw new Error(`Missing name (first) argument for this scan.`);
        if( defs == undefined || defs.length == 0 || defs[0] == undefined ) {
            throw new Error(`Missing def names for this scan. E.g. "S_CHAT"`);
        }
        msg.clear();
        let groupName = "def-scan-" + scanName;
        let noDefs = [];
        if( !hookManager.hasActiveGroup( groupName ) ) {
            for( let def of defs ) {
                let code = NAME_OPCODE_MAP.get( def );
                let version = LATEST_VERSION_MAP.get( def );
                if( code ) hookManager.hook( groupName, def, version, ( e ) => {
                    mod.command.message( `${def}${version?`[v${version}]`:""}(${code})` );
                    if( verbose ) mod.command.message( `Data: ${util.inspect( e )}` );
                });
                else noDefs.push( def );
            }
            msg.enable( "Start" );
        } else {
            hookManager.unhookGroup( groupName );
            msg.disable( "Stop" );
        }
        msg.color().text( " scanning " ).highlight( scanName ).color();
        msg.text( " for definitions " ).value( util.inspect( defs ) );
        chat.printMessage( msg.toHtml( true ) );
        if( noDefs.length > 0 ) {
            msg.text( "Could not scan following definitions: " );
            msg.value( util.inspect( noDefs ) );
            chat.printMessage( msg.toHtml( true ) );
        }
    }

    /**
     * Scans packets with specified opcodes. Logging them in file. File name will be
     * generated as "raw-opcode-" + name/opcode number.
     * @param  {[type]} scanName  the name of the scan
     * @param  {[type]} opcodes   the opcodes to be scanned
     */
    function scanOpcode( scanName, ...opcodes ) {
        if ( opcodes == undefined || opcodes.length == 0 || opcodes[0] == undefined )
            if ( Number.isInteger( parseInt( scanName ) ) ) opcodes = [scanName];
            else throw new Error( `Argument must be an integer opcode, when using only one argument.` );
        if ( scanName == undefined ) scanName = opcodes.toString();
        msg.clear();
        opcodes = opcodes.map( x => parseInt( x ) );
        let groupName = "opcode-scan-" + scanName;
        let result = hookManager.hook( groupName, "*", "raw", ( code, data, fromServer, fake ) => {
            if ( opcodes.includes( code ) ) {
                let left = fake && fromServer ? "P" : "S";
                let arrow = fromServer ? "->" : "<-";
                let right = fake && !fromServer ? "P" : "C";
                let opcodeName = OPCODE_NAME_MAP.get( code );
                let version = LATEST_VERSION_MAP.get( opcodeName );
                mod.command.message( `${left} ${arrow} ${right} ${code} (${opcodeName}${version?`[v${version}]`:""})` );
                if ( !logger[scanName]) {
                    logger[scanName] = bunyan.createLogger({
                        name: "opcode",
                        streams: [
                            {
                                path: path.join( OPCODES_PATH, scanName + ".log" ),
                                level: "debug"
                            }
                        ]
                    });
                }
                // if( !simpleLogger[scanName]) {
                //     const opts = {
                //         //errorEventName:'error',
                //         logDirectory: GENERAL_LOG_PATH,
                //         fileNamePattern: `${scanName}_<DATE>.log`,
                //         dateFormat:'YYYY-MM-DD'
                //     };
                //     simpleLogger[scanName] = SimpleLogManager.createRollingFileLogger( opts );
                // }
                let e = null;
                try {
                    e = mod.dispatch.protocol.parse( mod.dispatch.protocol.resolveIdentifier( opcodeName , version ? version : "*" ), data );
                    if( verbose ) mod.command.message( `Data: ${util.inspect( e )}` );
                } catch ( _ ) {
                    // did not work, so skip
                }
                if ( e != null ) {
                    logger[scanName].debug({
                        def: opcodeName != undefined ? opcodeName : "undefined",
                        version: version,
                        event: e
                    });
                } else {
                    let header = data.slice( 0, 4 );
                    let body = data.slice( 4 );
                    logger[scanName].debug({
                        def: opcodeName != undefined ? opcodeName : "undefined",
                        length: header.readUInt16LE(),
                        opcode: header.readUInt16LE( 2 ),
                        data: body,
                        hex: addSpace( body.toString( "hex" ), 4 ),
                        string: body.toString()
                    });
                }
            }
        });
        if ( !result.hook ) {
            delete logger[scanName];
            hookManager.unhookGroup( groupName );
            msg.disable( "Stop " );
        } else {
            msg.enable( "Start " );
        }
        msg.highlight( groupName );
        msg.color().text( " scanning for [" );
        let i = opcodes.length - 1;
        for ( let opcode of opcodes ) {
            msg.value( opcode );
            if ( i-- > 0 ) msg.color().text( "," );
        }
        msg.color().text( "]." );
        chat.printMessage( msg.toHtml() );
    }

    function addSpace( s, charNum = 2 ) {
        return s.replace( new RegExp( `.{${charNum}}\\B`, "g" ), "$& " );
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
        let size = OPCODE_NAME_MAP.size;
        let i = 0;
        for ( let name of OPCODE_NAME_MAP.values() ) {
            s += name;
            if ( i < size - 1 ) s += ", ";
            i++;
        }
        chat.printMessage( s );
    }

    function initGroupedOpcodeHooks() {
        for ( let [group, opcode] of GROUPED_OPCODE_MAP ) {
            hookManager.addTemplate( group, OPCODE_NAME_MAP.get( opcode ), "*", e => {
                chat.printMessage( JSON.stringify( e ) );
            });
        }
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
            chat.printMessage( `${typeName} (${ChatHelper.msToUTCTimeString( event.time )}) => ${event.loc}` );
        });

        hookManager.addTemplate( "positioning", "C_PLAYER_LOCATION", 5, event => ( lastLocation = event ) );

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

        // /*
        // # elite bar?
        // count inventory
        // offset inventory
        //
        // int32 size
        //
        // array inventory
        // - int32 slot
        // - int32 type # 1 = item, 2 = skill
        // - int32 skill
        // - int32 item
        // - int32 amount
        // - int32 cooldown
        // */
        // hookManager.addTemplate( "elite-bar", "S_PCBANGINVENTORY_DATALIST", 1, event => {
        //     let s = "Elite bar:\n[";
        //     for ( let item of event.inventory ) {
        //         s += item.slot;
        //         switch ( item.type ) {
        //             case 1:
        //                 s += `# item: ${item.item}`;
        //                 break;
        //             case 3:
        //                 s += `# skill: ${item.skill}`;
        //                 break;
        //             default:
        //                 s += `# unknown (${item.type})`;
        //         }
        //         s += ` (count: ${item.amount}, cd: ${item.cooldown})\n`;
        //     }
        //     s += "]";
        //     chat.printMessage( s );
        // });
        //
        // /* int32 slot */
        // hookManager.addTemplate( "elite-bar", "C_PCBANGINVENTORY_USE_SLOT", 1, event => {
        //     chat.printMessage( "Use elite-bar slot " + event.slot );
        // });

        /*
        int32 set
        array inventory
        - int32 slot
        - int32 type # 1 = item, 2 = skill
        - int32 skill
        - int32 item
        - int64 cooldown
        */
        hookManager.addTemplate( "premium", "S_PREMIUM_SLOT_DATALIST", 2, event => {
            let s = "Premium bar:\n[";
            for ( let item of event.inventory ) {
                s += item.slot;
                switch ( item.type ) {
                    case 1:
                        s += `# item id: ${item.id}`;
                        break;
                    case 3:
                        s += `# skill id: ${item.id}`;
                        break;
                    default:
                        s += `# unknown type (${item.type}) id: ${item.id}`;
                }
                s += ` (count: ${item.amount}, cd: ${item.cooldown})\n`
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
        hookManager.addTemplate( "premium", "C_USE_PREMIUM_SLOT", 1, event => {
            let s = `Use premium bar slot ${event.slot} (set:${event.set})`;
            switch ( event.type ) {
                case 1:
                    s += `# item id: ${event.id}`;
                    break;
                case 3:
                    s += `# skill id: ${event.id}`;
                    break;
                default:
                    s += `# unknown type (${event.type}) id: ${event.id}`;
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
        hookManager.addTemplate( "buff", "S_ABNORMALITY_BEGIN", 4, e => {
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
        hookManager.addTemplate( "buff", "S_ABNORMALITY_REFRESH", 2, e => {
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
        hookManager.addTemplate( "buff", "S_ABNORMALITY_FAIL", 2, e => {
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
        hookManager.addTemplate( "chat", "S_CHAT", 3, e => {
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
        hookManager.addTemplate( "chat", "S_WHISPER", 3, e => {
            chat.printMessage( `${e.name}${e.gm?"[GM]":""} -> ${e.recipient}: "${e.message}"` );
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
            chat.printMessage( `${e.authorName}(${e.authorID}): "${e.message}"` );
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
        hookManager.addTemplate( "chat", "S_PARTY_MATCH_LINK", 2, e => {
            chat.printMessage( `${e.name}: "${e.message}" (${e.id}, ${e.unk2}=70?=>level limit)` );
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

        const dbMap = new Map([
            [365, "Pearl"],
            [366, "Ruby"],
            [1300, "Noctenium Infusion"],
            [6552, "Prime Recovery Potable"],
            [9366, "Veteran's Fragment Box"],
            [9367, "Veteran's Plate Box"],
            [9387, "Veteran's Cube Token"],
            [9368, "Veteran's Talent Box"],
            [45474, "Dragon Wing Scale"],
            [81212, "Friendly Noctenium Infusion"],
            [88838, "Accessory Amplifier Crate I"],
            [88839, "Accessory Amplifier Crate II"],
            [88840, "Bahaar's Amplifier Coin"],
            [98523, "Metamorphic Emblem"],
            [98527, "Enchanting Box (white)"],
            [98528, "Enchanting Chest (green)"],
            [98529, "Enchanting Crate (blue)"],
            [98530, "Twistshard Equipment Chest"],
            [98531, "Frostmetal Equipment Chest"],
            [98532, "Stormcry Equipment Chest"],
            [98533, "Brilliant Enchanting Box (white)"],
            [98534, "Brilliant Enchanting Crate (green)"],
            [98535, "Brilliant Enchanting Chest (blue)"],
            [98536, "Champion's Enchanting Chest"],
            [98549, "Dawnfall Token"],
            [98550, "Dawnstorm Token"],
            [98582, "Guardian Legion Jewel Box"],
            [98590, "Veilthroch"],
            [98592, "Caiman Stash Key"],
            [98593, "Champion's Enchanting Chest II"],
            [98652, "[Event] Champion's Mark"],
            [98653, "Supreme Metal"],
            [98654, "Springy Draco Limb"],
            [98655, "Weight Pendulum"],
            [98656, "Sacred Mallet"],
            [98657, "Champion's Enchanting Chest III"],
            [98658, "Empowered Enchanting Chest"],
            [99977, "Pilot's Token"],
            [200999, "Prime Battle Solution"],
            [204051, "Angler Token"],
            [206005, "Red Angleworm"],
            [204068, "Gathered Materials Box"],
            [602067, "Yana's D6"],
            [602068, "Yana's Loaded D6"],
            [20000000, "Money"],
            [20000001, "XP"],
            [20000002, "Unspecified Reward"],
            [20000008, "Credits"],
            [20000018, "EP-XP"],
            [20000019, "EP-XP+"],
            [20000020, "EP-XP++"],
            [20000022, "Item XP"]
        ]);

        hookManager.addTemplate( "daily", "S_AVAILABLE_EVENT_MATCHING_LIST", 2, e => {
            msg.clear();
            msg.text( "Daily List -->" );
            msg.text( "level: " );
            msg.value( e.level );
            msg.color().text( " limit: " );
            msg.value( e.limitAll );
            msg.color().text( "(all)/" );
            msg.value( e.limitDungen );
            msg.color().text( "(dungeon)/" );
            msg.value( e.limitPvp );
            msg.color().text( "(pvp)/" );
            msg.value( e.limitSolo );
            msg.color().text( "(solo)" );
            chat.printMessage( msg.toHtml() );
            chat.printMessage( "quests: [" );
            for ( let quest of e.quests ) {
                msg.clear();
                msg.highlight( quest.id ).color();
                msg.text( ", rewards: [" );
                let countDown = quest.rewards.length - 1;
                for ( let r of quest.rewards ) {
                    let hasId = dbMap.has( r.dbid );
                    let desc = hasId ? dbMap.get( r.dbid ) : r.dbid;
                    if ( !hasId ) msg.color( ChatHelper.COLOR_DISABLE );
                    msg.text( desc );
                    msg.color().text( ":" );
                    let amount = r.amount;
                    if ( r.dbid == 20000000 ) {
                        let gold = Math.floor( r.amount / 10000 );
                        let silver = Math.floor( amount / 100 ) - gold * 100;
                        let copper = amount - gold * 10000 - silver * 100;
                        msg.value( gold );
                        msg.color().text( "g" );
                        msg.value( ChatHelper.addPrefixZero( silver ) );
                        msg.color().text( "s" );
                        msg.value( ChatHelper.addPrefixZero( copper ) );
                        msg.color().text( "c" );
                    } else {
                        msg.value( amount ).color();
                    }
                    if ( countDown-- > 0 ) msg.text( "," );
                }
                msg.text( "]" );
                chat.printMessage( msg.toHtml() );
            }
            chat.printMessage( "]" );
            chat.printMessage( "Daily List <--" );
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
            msg.text( "EP: " ).value( e.totalPoints );
            msg.color().text( "Gained?: " );
            msg.value( e.gainedPoints );
            chat.printMessage( msg.toHtml() );
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

class UtilityBox {
    constructor( mod ) {
        let lib = mod.require["util-lib"];
        HookManager = lib["hook-manager"];
        hookManager = new HookManager( mod );
        MessageBuilder = lib["message-builder"];
        msg = new MessageBuilder();
        ChatHelper = lib["chat-helper"];
        chat = new ChatHelper( mod );
        FileHelper = lib["file-helper"];
        utilityBox( mod );
        this.mod = mod;
    }

    destructor() {
        let posData = [];
        if( positions != undefined ) {
            positions.forEach( ( v, k ) => posData.push([k, v]) );
            FileHelper.saveJson( posData, POSITIONS_PATH );
        }
        if( dynamicTemplates != undefined ) {
            FileHelper.saveJson( dynamicTemplates, TEMPLATES_PATH );
        }
        stopScanning();
    }
}
module.exports = UtilityBox;
