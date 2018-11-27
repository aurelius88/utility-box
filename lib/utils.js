

class Utilities {

    constructor( mod ) {
        this.COLOR_ENABLE = "#56B4E9";
        this.COLOR_DISABLE = "#e64500";
        this.COLOR_COMMAND = "#e6a321";
        this.COLOR_VALUE = "#09d1d1";
        this.COLOR_HIGHLIGHT = "#81ee7b";
        this.mod = mod;
    }

    /**
     * Prints the message in game and in console with local time stamp.
     * @param  {string}  message           The message.
     * @param  {Boolean} [consoleOut=true] Also print in console?
     * @memberOf OutputHelper
     */
    printMessage( message, consoleOut = true ) {
        let timedMessage =
            `[${new Date().toLocaleTimeString()}]: ${message}`;
        this.mod.command.message( timedMessage );
        if ( consoleOut )
            console.log( Utilities.cleanString( timedMessage ) );
    }

    /**
     * Returns a html-tag-free string.
     * @param  {string} dirtyString the string with html tags.
     * @return {string}             a html-tag-free string.
     * @static
     * @memberOf OutputHelper
     */
    static cleanString( dirtyString ) {
        return dirtyString.replace( /<[^>]*>/g, "" );
    }

    /**
     * Converts a time in milliseconds to UTC time string.
     * @param  {Number} timeInMs The time in milliseconds as integer.
     * @return {string}          Returns the time in the format: hh:MM:SS
     * @static
     * @memberOf OutputHelper
     */
    static msToUTCTimeString( timeInMs ) {
        let secs = Math.floor( timeInMs / 1000.0 ),
            mins = Math.floor( secs / 60.0 ),
            h = Math.floor( mins / 60.0 ),
            s = secs % 60,
            m = mins % 60;
        s = Utilities.addPrefixZero( s );
        m = Utilities.addPrefixZero( m );
        h = Utilities.addPrefixZero( h );
        return `${h}:${m}:${s}`;
    }

    /**
     * Adds a zero to numbers smaller than 10.
     * @param {[type]} num The number to be formatted.
     * @return Returns the number as string with 0 prefix or
     * the number if no prefix needed.
     * @static
     * @memberOf OutputHelper
     */
    static addPrefixZero( num ) {
        if ( num < 10 ) {
            num = "0" + num;
        }
        return num;
    }
}

module.exports = Utilities;
