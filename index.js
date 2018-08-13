/* jshint esnext:true, node:true */
const Command = require('command');
const vec3 = require('tera-vec3');
const path = require('path');
const fs = require('fs');

function getJsonData(pathToFile) {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, pathToFile)));
    } catch(e) {
        return undefined;
    }
}

function saveJsonData(pathToFile, data) {
    fs.writeFileSync(path.join(__dirname, pathToFile), JSON.stringify(data, null, 4));
}

module.exports = function utilityBox(dispatch) {
    dispatch.game.initialize(["me", "contract"]);
	const command = Command(dispatch);
    const moduleName = "util";

    let hooks = [],
		gameId = null,
		scanning = false,
		lastLocation = null,
        positions = new Map(),
        fileName = "positions.json";
        
    dispatch.game.on("enter_game", () => {
        let data = getJsonData(fileName);
        if(Array.isArray(data)) {
            positions = new Map(data);
        }
        gameId = dispatch.game.me.gameId;
        scanning = true;
        startScanning();
    });
    
    dispatch.game.on('leave_game', () => {
        let posData = [];
        positions.forEach((v,k) => posData.push([k,v]));
        saveJsonData(fileName,posData);
        scanning = false;
        stopScanning();
    });

	command.add(moduleName, parseArgs);
    
    function switchScanning() {
        if(scanning = !scanning) startScanning();
        else stopScanning();
    }

    function parseArgs(argument,arg1,arg2) {
        //command.message(`args: "${argument}", "${arg1}", "${arg2}"`);
        if(argument == "scan") {
            switchScanning();
        } else if (argument === "pos") {
            if (arg1 === "save") {
                if(arg2 !== undefined && arg2 !== "") {
                    if(arg2 === "list" || arg2 === "save" || arg2 === "delete" || arg2 === "reset") {
                        command.message('You cannot name your position to "save", "delete", "reset" or "list". Please choose another name.');
                    } else {
                        savePosition(arg2);
                    }
                } else {
                    command.message("Missing arguments: "+argument+" "+arg1+" "+arg2);
                    command.message("Usage: "+moduleName+" "+argument+" save name");
                }
            } else if(arg1 === "list") {
                listPositions();
            } else if(arg1 === "delete") {
                if(arg2 !== undefined && arg2 !== "") {
                    if(positions.delete(arg2)) {
                        command.message(`Position "${arg2}+" deleted.`);
                    } else {
                        command.message(`There is no position with name "${arg2}".`);
                    }
                } else {
                    command.message("Missing arguments: "+argument+" "+arg1+" "+arg2);
                    command.message("Usage: "+moduleName+" "+argument+" delete name");
                }
                
            } else if(arg1 === "reset") {
                positions.clear();
            } else if(arg1 !== undefined && arg1 !== "") {
                let location = positions.get(arg1,null);
                if(location !== null) {
                    command.message(`"${arg1}": ${location}`);
                } else {
                    command.message(`There is no position with name "${arg1}".`);
                }
            } else if(arg1 === undefined || arg1 === "") {
                if(lastLocation !== undefined) {
                    command.message(`Current Position:  ${lastLocation}`);
                } else {
                    command.message("No position, yet. Please move one step or jump to get your position. And try it again.");
                }
            } else {
                command.message("Usage for: "+moduleName+" "+argument);
                command.message("pos: get current postiton.");
                command.message('pos save name: save current position to "name".');
                command.message('pos delete name: deletes position named "name".');
                command.message("pos list: list all saved positions.");
                command.message('pos name: display position saved as "name".');
            }
       } else {
            command.message("GameId = "+gameId);
            command.message("Scanning: "+(scanning? "ON" : "OFF"));
            command.message("---");
            command.message("Usage: "+moduleName+" argument");
            command.message("---");
            command.message("Arguments:");
            command.message("pos:           get current postiton.");
            command.message("pos save name: save current position to 'name'.");
            command.message("pos list:      list all saved positions.");
            command.message("pos name:      display position saved as 'name'.");
       }
	}
    
    function savePosition(name) {
        if(positions.has(name)) {
            command.message("There is already a position saved with this name. Choose another name.");
            return false;
        }
        let pos = lastLocation;
        positions.set(name, pos);
        command.message(`Position "${JSON.stringify(pos)}" saved as "${name}".`);
        return true;
    }

    function printPositions(value, key) {
        command.message(`"${key}": ${JSON.stringify(value)}`);
    }
    
    function listPositions() {
        command.message(positions.size+" positions saved:");
        positions.forEach(printPositions);
    }
    
    function startScanning() {
        /*
        vec3    loc
        angle   w
        angle   LookDirection 
        # w direction but while in an action that allows you to look around example: Gunner Blast/Arcane Barrage
        int16   speed
        vec3    dest
        int32   type 
        # 0 = running, 1 = walking, 2 = falling, 5 = jumping,
        # 6 = jump intersection and end when something is blocking the path and the player can't
        # travel in the X and Y axis(it will then wait and resume if possible)
        # 7 = stop moving, landing
        # 8 = swimming, 9 = stop swimming, 10 = falling after jumping
        bool    inShuttle
        */
        hook('C_PLAYER_LOCATION', 4, event => {
            let typeName = "";
            switch(event.type) {
                case 0: typeName="running"; break;
                case 1: typeName="walking"; break;
                case 2: typeName="falling"; break;
                case 5: typeName="jumping"; break;
                case 6: typeName="jumping interrupted"; break;
                case 7: typeName="stop moving/landing"; break;
                case 8: typeName="swimming"; break;
                case 9: typeName="stop swimming"; break;
                case 10: typeName="falling after jumping"; break;
                default: typeName="Unknown: "+event.type;
            }
            lastLocation = event.loc;
            //command.message(`${typeName} (${event.speed}) => ${event.loc}`);
        });
        command.message('Scanning started.');
    }

	function stopScanning() {
		unload();
		scanning = false;
		command.message('Scanning stopped.');
	}

    
    function unloadSpecific(specHook) {
        let newHooks = [];
        if(hooks.length) {
            for(let h of hooks) {
                if(h != specHook)
                    newHooks.push(h);
                else
                    dispatch.unhook(h);
            }
        }
        hooks = newHooks;
    }

	function unload() {
		if(hooks.length) {
			for(let h of hooks) dispatch.unhook(h);
			hooks = [];
		}
	}

	function hook() {
        var h = dispatch.hook(...arguments);
		hooks.push(h);
        return h;
	}
};
