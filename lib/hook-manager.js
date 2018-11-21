const binarySearch = require( 'binary-search' );

/**
 * Manages hooks by grouping and storing their source and hook objects, when hooked.
 */
class HookManager {
    constructor( dispatch ) {
        this.hookTemplates = new Map();
        this.activeHooks = new Map();
        this.dispatch = dispatch;
    }

    /**
    * The active hooks.
    * @returns a map of group -> list of active hooks. ({group: groupname, args: [arg array], hook: hook} array)
    */
    getActiveHooks() { return new Map(this.activeHooks); }

    /**
    * The hook templates.
    * @returns a map of group -> list of hook templates ([hook arg array] array)
    */
    getHookTemplates() { return new Map(this.hookTemplates); }

    /**
     * Adds a grouped hook. Sorted insertion.
     * @param group       the name of the group.
     * @param hookArgs    the arguments of the hook (name, version, [options], callback)
     * @returns     a hook template to identify the hook or an empty object
     *              if the same template is already added.
     */
    addTemplate( group, ...hookArgs ) {
        if ( ![ 'string', 'number' ].includes( typeof group ) ) throw new TypeError(
            "group should be a string or a number." );
        if ( !hookArgs || hookArgs.length < 3 ) {
            throw new Error(
                `ArgumentError: Missing arguments in\n
                ${JSON.stringify(hookArgs)}\n
                (length: ${hookArgs ? hookArgs.length : "Not even an array"}, but should be 3 or 4).`
            );
        }
        if ( hookArgs.length > 4 ) {
            throw new Error(
                `ArgumentError: Too many arguments. There were ${hookArgs.length}, but should be 3 or 4.`
            );
        }
        if ( this.hookTemplates.has( group ) ) {
            let hookArgsArray = this.hookTemplates.get( group );
            let idx = binarySearch( hookArgsArray, hookArgs, HookManager._compareArgs );
            // sorted insert if not already added
            if ( idx < 0 ) hookArgsArray.splice( ~idx, 0, hookArgs );
            else return {}; // already added
        } else {
            this.hookTemplates.set( group, [ hookArgs ] );
        }
        return { group: group, args: hookArgs };
    }

    /**
     * Removes a hook by an hook object containing group and template.
     * @param hookObj     The obj containing the group and the hook arguments:
     *                  \{group: \<name\>, args: \<[arguments]\>\}
     * @returns     true if removal was successful, otherwise false.
     */
    removeTemplate( templateObj ) {
        let hookArgsArray = this.hookTemplate.get( templateObj.group );
        if ( !hookArgsArray ) return false;
        let index = binarySearch( hookArgsArray, templateObj.args, HookManager._compareArgs );
        return this._removeTemplateAt( templateObj.group, index, hookArgsArray );
    }

    /**
     * Removes a grouped hook template within the group named group at position index.
     * @param group   The group name.
     * @param index   The index of the hook to be removed inside the group.
     * @returns     true if removal was successful, otherwise false.
     */
    removeTemplateAt( group, index ) {
        if ( this.hookTemplates.has( group ) ) {
            return this._removeTemplateAt(group, index, this.hookTemplates.get( group ));
        }
        return false;
    }

    /**
    * Removes a grouped hook template within the group named group at position index.
    * @param  {[type]} group         [description]
    * @param  {[type]} index         [description]
    * @param  {[type]} hookArgsArray [description]
    * @return {[type]}               [description]
    */
    _removeTemplateAt(group, index, hookArgsArray) {
        if ( group && index >= 0 ) {
            if ( hookArgsArray.length > 1 )
                return hookArgsArray.splice( index, 1 ).length;
            else // last element to be removed => remove group
                return this.hookTemplates.delete( group );
        }
        return false;
    }

    /**
     * Removes all templates with the given name in the specified group
     * or in all groups if group is not specified.
     * @param  {[type]} name  The name of the hook (as specified in the hook args) to be removed.
     * @param  {[type]} group The group that contains the hook template with the given name. [optional]
     * @return {[type]}       true, if successfully removed all occurences.
     *                        false, if there was nothing to remove.
     */
    removeTemplateByName( name, group ) {
        if(group) {
            let foundArr = [];
            if(!this.hookTemplates.has(group)) return false;
            let groupArr = this.hookTemplates.get(group);
            for(let i = 0; i < groupArr.length; i++) {
                if(groupArr[i][0] === name) {
                    foundArr.push(i);
                }
            }
            let result = foundArr.map(x => this._removeTemplateAt(group,x,groupArr),this);
            return result.reduce((a,c) => a || c);
        } else {
            let result = [];
            for(let g of this.hookTemplates.keys()) {
                result.push(this.removeTeplateByName(name, g));
            }
            return result.reduce((a,c) => a || c);
        }
    }

    /**
     * Removes a whole group of templates.
     * @returns     true if successfully removed, otherwise false.
     */
    removeGroup( group ) {
        return this.hookTemplates.delete( group );
    }

    /** Removes all templates. */
    removeAll() {
        this.hookTemplates.clear();
    }

    /**
     * Compares two argument arrays with eachother.
     * @param argsA   The argument array on the left side.
     * @param argsB   The arguemnt array on the right side.
     * @returns     -1 if argsA \< argsB, 0 if equal and 1 otherwise.
     */
    static _compareArgs( argsA, argsB ) {
        if ( !argsA ) return argsB ? 1 : 0;
        if ( !argsB ) return -1;
        let strA = "",
            strB = "";
        strA = HookManager._appendArrayString( strA, argsA );
        strB = HookManager._appendArrayString( strB, argsB );
        return strA.localeCompare( strB );
    }

    /**
     * Compares two hook objects with eachother.
     * @param hookA   The left hook object.
     * @param hookB   The right hook object.
     * @returns     -1 if hookA \< hookB, 0 if equal or 1 otherwise.
     */
    static _compareHooks( hookA, hookB ) {
        if ( !hookA ) return hookB ? 1 : 0;
        if ( !hookB ) return -1;
        let strA = "",
            strB = "";
        strA = HookManager._appendObjectString( strA, hookA );
        strB = HookManager._appendObjectString( strB, hookB );
        return strA.localeCompare( strB );
    }

    /**
     * Appends object elements and it's children to a string.
     * @param {string} str    The string to be appended.
     * @param {object} obj    The object with its elements.
     */
    static _appendObjectString( str, obj ) {
        if ( !obj ) return str;
        if ( typeof obj != 'object' ) throw new Error(
            "2nd argument is not an object." );
        str += '{';
        let keys = Object.keys( obj );
        let i = 0;
        for ( ; i < keys.length - 1; i++ ) {
            let o = keys[ i ];
            str += o + ':';
            str = HookManager._append( str, obj[ o ] ) + ',';
        }
        if ( i < keys.length ) {
            let o = keys[ i ];
            str += o + ':';
            str = HookManager._append( str, obj[ o ] );
        }
        return str + '}';
    }

    /** Appends an object to a string.  */
    static _append( str, obj ) {
        if ( Array.isArray( obj ) ) {
            return HookManager._appendArrayString( str, obj );
        } else if ( typeof obj == 'object' ) {
            return HookManager._appendObjectString( str, obj );
        } else if ( typeof obj == 'function' )
            str += obj.toString().replace( /\s/g, '' );
        else
            str += JSON.stringify( obj );
        return str;
    }

    /**
     * Appends all array elements and it's children to a string.
     * @param {string} str    The string to be appended.
     * @param {Array} arr     The array with its elements.
     */
    static _appendArrayString( str, arr ) {
        if ( !arr ) return str;
        str += '[';
        let i = 0;
        for ( ; i < arr.length - 1; i++ ) {
            str = HookManager._append( str, arr[ i ] ) + ',';
        }
        if ( i < arr.length ) {
            str = HookManager._append( str, arr[ i ] );
        }
        str += ']';
        return str;
    }

    /**
     * Hooks and saves the return value of {@link dispatch#hook}.
     * @param {string|int} group      The group of the hook
     * @param {...object} hookArgs    The hook arguments as in {@link dispatch#hook}
     * @returns     a hook obj: \{group, args, hook\} or \{group, args\} if the hook already exists
     */
    hook( group, ...hookArgs ) {
        if ( ![ 'string', 'number' ].includes( typeof group ) ) throw new TypeError(
            "group should be a string or a number." );
        this.addTemplate( group, ...hookArgs );
        var h = this.dispatch.hook( ...hookArgs );
        let hookGroup = this.activeHooks.get( group );
        let hookObj = { group: group, args: hookArgs, hook: h };
        if ( hookGroup ) {
            let idx = binarySearch( hookGroup, hookObj, HookManager._compareHooks );
            // add hook if not exists
            if ( idx < 0 ) hookGroup.splice( ~idx, 0, hookObj );
            else {
                // XXX maybe to expensive operation. other solution?
                // revert hook
                this.dispatch.unhook( h );
                return { group: group, args: hookArgs };
            }
        } else {
            this.activeHooks.set( group, [ hookObj ] );
        }
        return Object.freeze( { group: group, args: hookArgs, hook: h } );
    }

    hasGroup( group ) {
        return this.hookTemplates.has( group );
    }

    hasActiveGroup( group ) {
        return this.activeHooks.has( group );
    }

    /**
     * Hooks a group of templates.
     * @returns     an array of hook objects or an empty array if there was nothing to hook.
     */
    hookGroup( group ) {
        let hooks = [];
        if ( this.hookTemplates.has( group ) ) {
            let hookArgs = this.hookTemplates.get( group );
            for ( let args of hookArgs ) {
                hooks.push( this.hook( group, ...args ) );
            }
        }
        return hooks;
    }

    /**
     * Hooks all not yet hooked templates.
     * @returns     an array of the hooked objects or an empty array if there was nothing to hook.
     */
    hookAll() {
        let hooks = [];
        for ( let groupTemps of this.hookTemplates ) {
            let group = groupTemps[ 0 ];
            let temps = groupTemps[ 1 ];
            for ( let args of temps ) hooks.push( this.hook( group, ...args ) );
        }
        return hooks;
    }

    /**
     * Unhooks the specific hook object.
     * @param hookObj     The hook object: \{ group : ..., args : ..., hook : ...\}
     */
    unhook( hookObj ) {
        if ( !hookObj ) {
            throw new Error(
                "ArgumentError: hookObj must not be undefined." );
        }

        if ( this.activeHooks.size && hookObj.hook ) {
            let hooks = this.activeHooks.get( hookObj.group );
            if ( !hooks ) hooks = [];
            let index = binarySearch( hooks, hookObj, HookManager._compareHooks );
            this._unhookAt(hookObj.group, index, hooks);
        }
    }

    /**
     * Unhooks the specific hook object at the given group and index.
     * @param group   The group that includes the hook object.
     * @param index   The index of the hook object.
     */
    unhookAt( group, index ) {
        this._unhookAt(group, index, this.activeHooks.get( group ));
    }


    _unhookAt( group, index, hooks) {
        if ( ![ 'string', 'number' ].includes( typeof group ) ) throw new TypeError(
            "group should be a string or a number." );
        if(index >= 0 && index < hooks.length) {
            this.dispatch.unhook(hooks[index].hook);
            if ( hooks.length > 1 )
                hooks.splice( index, 1 );
            else {
                this.activeHooks.delete( group );
            }
            // else nothing to unhook
        }
    }

    /**
     * Unhooks all hooks with the given name in the specified group or in all groups
     * if group is not specified.
     * @param  {[type]} name  The name of the hook.
     * @param  {[type]} group The group that contains the hook. [optional]
     */
    unhookByName( name, group ) {
        if(group) {
            if(!this.activeHooks.has(group)) return false;
            let foundNameIndices = [];
            let hookObjs = this.activeHooks.get(group);
            for(let i = 0; i < hookObjs.length; i++) {
                if(hookObjs[i].args[0] === name) foundNameIndices.push(i);
            }
            foundNameIndices.map( nameIndex => this.unhookAt(group, nameIndex) );
        } else {
            for(let g of this.activeHooks.keys()) {
                this.unhookByName(name, g);
            }
        }
    }

    /**
     * Unhooks a group of hooks.
     * @params group The group to unhook.
     */
    unhookGroup( group ) {
        let hookObjs = this.activeHooks.get( group );
        if ( hookObjs ) {
            for ( let hookObj of hookObjs )
                this.dispatch.unhook( hookObj.hook );
            return this.activeHooks.delete( group );
        } else {
            HookManager.printMessage( "Group does not exist." );
            return false;
        }
    }

    /** Unhooks them all. */
    unhookAll() {
        if ( this.activeHooks.size ) {
            for ( let hookObjs of this.activeHooks.values() ) {
                for ( let hookObj of hookObjs )
                    this.dispatch.unhook( hookObj.hook );
            }
            this.activeHooks.clear();
        }
    }

    //###################
    // Helper Functions
    //#################
    /** Prints the message in game and in console with local time stamp. */
    static printMessage( message ) {
        let timedMessage =
            `[${new Date().toLocaleTimeString()}]: ${message}`;
        console.log( HookManager.cleanString( timedMessage ) );
    }

    /**
     * @returns Returns a html-tag-free string.
     */
    static cleanString( dirtyString ) {
        return dirtyString.replace( /<[^>]*>/g, "" );
    }

    /**
     * A string representation of the HookManager.
     * @see Object#toString()
     * @override
     */
    toString() {
        let str = "\nHookManager {\n  Templates: [\n";
        let i = 0;
        for ( let g of this.hookTemplates ) {
            str += "    " + g[ 0 ] + " => " + JSON.stringify( g[ 1 ] );
            if ( i++ < this.hookTemplates.size - 1 ) str += ',\n';
        }
        i = 0;
        str += "\n  ],\n  Active Hooks: [\n";
        for ( let g of this.activeHooks ) {
            str += "    " + g[ 0 ] + " => " + JSON.stringify( g[ 1 ].args );
            if ( i++ < this.activeHooks.size - 1 ) str += ',\n';
        }
        return str + "\n  ]\n}\n";
    }
}

module.exports = HookManager;
