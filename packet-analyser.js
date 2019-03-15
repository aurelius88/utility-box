const { Readable } = require( "../../node_modules/tera-data-parser/lib/protocol/stream" );

const TYPES = [
    "bool",
    "byte",
    "int16",
    "uint16",
    "int32",
    "uint32",
    "float",
    "int64",
    "uint64",
    "double",
    "vec3",
    "vec3fa",
    "angle",
    "skillid32",
    "skillid",
    "customize",
    "float",
    "double",
    "string",
    "array",
    "object"
];

function choose( type, readable ) {
    switch ( type ) {
        case "bool":
            return readable.bool();
        case "byte":
            return readable.byte();
        case "uint16":
            return readable.uint16();
        case "uint32":
            return readable.uint32();
        case "uint64":
            return readable.uint64();
        case "int16":
            return readable.int16();
        case "int32":
            return readable.int32();
        case "int64":
            return readable.int64();
        case "vec3":
            return readable.vec3();
        case "vec3fa":
            return readable.vec3fa();
        case "angle":
            return readable.angle();
        case "skillid32":
            return readable.skillid32();
        case "skillid":
            return readable.skillid();
        case "customize":
            return readable.customize();
        case "float":
            return readable.float();
        case "double":
            return readable.double();
        case "string":
            return readable.string();
        case "array":
        case "object":
        default:
            throw new TypeError( `Type "${type}" is not supported.` );
    }
}

class PacketAnalyser extends Readable {
    constructor( bufferData, opcode ) {
        super( Buffer.from( bufferData ) );
        this.length = this.buffer.length;
        this.selectedPosition = 0;
        this.analysedPacket = [];
        this.undoList = [];
        this.opcode = opcode;
        // initialize header
        this.choose( "uint16" ); // length
        this.choose( "uint16" ); // opcode
    }

    readAllCustom( byteSize, read ) {
        let i = 0;
        let shift = 1;
        let packets = [];
        while ( shift > 0 ) {
            let packet = [];
            let lengths = [];
            if ( i > 0 ) {
                packet.push( read( 0, i ) );
                lengths.push( i );
            }
            while ( i <= this.length - byteSize ) {
                packet.push( read( i, byteSize ) );
                lengths.push( byteSize );
                i = i + byteSize;
            }
            if ( i < this.length ) {
                packet.push( read( i, this.length - i ) );
                lengths.push( this.length - i );
                i = shift;
                shift++;
            } else {
                shift = 0;
            }
            packets.push({ packet, lengths });
        }
        return packets;
    }

    get currentBufferSegment() {
        return this.buffer.slice( this.selectedPosition );
    }

    readAllInt( byteSize ) {
        return this.readAllCustom( byteSize, this.buffer.readIntLE );
    }

    readAllUInt( byteSize ) {
        return this.readAllCustom( byteSize, this.buffer.readUIntLE );
    }

    try( type ) {
        if ( !TYPES.includes( type ) ) throw new TypeError( `Type "${type}" is unknown. Available types: ${TYPES}` );
        let value = choose( type, this );
        let length = this.position - this.selectedPosition;
        this.position = this.selectedPosition;
        return { type, value, length };
    }

    tryAll() {
        let data = [];
        let tmpPos = this.position;
        for ( let type of TYPES ) {
            try {
                data.push( this.try( type ) );
            } catch ( _ ) {
                // revert position if changed and skip unsupported types
                this.position = tmpPos;
            }
        }
        return data;
    }

    choose( type ) {
        if ( !TYPES.includes( type ) ) throw new TypeError( `Type "${type}" is unknown. Available types: ${TYPES}` );
        let value = choose( type, this );
        let length = this.position - this.selectedPosition;
        this.selectedPosition = this.position;
        let returnObj = { type, value, length };
        this.analysedPacket.push( returnObj );
        return returnObj;
    }

    undo() {
        if ( this.analysedPacket.length <= 0 ) return false;
        let line = this.analysedPacket.pop();
        this.undoList.push( line );
        this.position = this.selectedPosition -= line.length;
        return true;
    }

    redo() {
        if ( this.undoList.length <= 0 ) return false;
        let { type } = this.undoList.pop();
        this.choose( type );
        return true;
    }

    isFinished() {
        return this.selectedPosition >= this.length || this.position >= this.length;
    }
}
module.exports = PacketAnalyser;
