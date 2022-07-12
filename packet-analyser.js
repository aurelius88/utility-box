const { Customize, SkillID, Vec3 } = require('../../node_modules/tera-data-parser/lib/protocol/types')

const MULT_INT16_TO_RAD = 1 / 0x8000 * Math.PI,
      MULT_RAD_TO_INT16 = 1 / Math.PI * 0x8000

class Readable {
    constructor(buffer, position = 0) {
        this.buffer = buffer
        this.position = position
    }

    seek(n) { return this.position = n }
    skip(n) { return this.position += n }

    bool() {
        const ret = this.byte()
        if(ret > 1) console.log(new Error('read byte not 0 or 1 for bool'))
        return !!ret
    }

    byte() { return this.buffer.readUInt8(this.position++) }

    bytes(n) { return Buffer.from(this.buffer.slice(this.position, this.position += n)) }

    uint16() {
        const ret = this.buffer.readUInt16LE(this.position)
        this.position += 2
        return ret
    }

    uint32() {
        const ret = this.buffer.readUInt32LE(this.position)
        this.position += 4
        return ret
    }

    uint64() {
        const ret = this.buffer.readBigUInt64LE(this.position)
        this.position += 8
        return ret
    }

    int16() {
        const ret = this.buffer.readInt16LE(this.position)
        this.position += 2
        return ret
    }

    int32() {
        const ret = this.buffer.readInt32LE(this.position)
        this.position += 4
        return ret
    }

    int64() {
        const ret = this.buffer.readBigInt64LE(this.position)
        this.position += 8
        return ret
    }

    vec3() {
        return new Vec3(this.float(), this.float(), this.float())
    }

    vec3fa() {
        return new Vec3(this.float() * MULT_INT16_TO_RAD, this.float() * MULT_INT16_TO_RAD, this.float() * MULT_INT16_TO_RAD)
    }

    angle() {
        return this.int16() * MULT_INT16_TO_RAD
    }

    skillid32() {
        const raw = this.uint32(),
            type = (raw >> 26) & 0xf,
            npc = Boolean(raw & 0x40000000),
            hasHuntingZone = npc && type === 1

        return new SkillID({
            id: raw & (hasHuntingZone ? 0xffff : 0x3ffffff),
            huntingZoneId: hasHuntingZone ? ((raw >> 16) & 0x3ff) : 0,
            type,
            npc,
            reserved: raw >> 31
        })
    }

    skillid() {
        const raw = this.uint64(),
            type = Number((raw >> BigInt(28)) & BigInt(0xf)),
            npc = Boolean(raw & BigInt(0x0100000000)),
            hasHuntingZone = npc && type === 1

        return new SkillID({
            id: Number(raw & (hasHuntingZone ? BigInt(0xffff) : BigInt(0xfffffff))),
            huntingZoneId: hasHuntingZone ? Number((raw >> BigInt(16)) & BigInt(0xfff)) : 0,
            type,
            npc,
            reserved: Number(raw >> BigInt(33))
        })
    }

    customize() {
        return new Customize(this.uint64());
    }

    float() {
        const ret = this.buffer.readFloatLE(this.position)
        this.position += 4
        return ret
    }

    double() {
        const ret = this.buffer.readDoubleLE(this.position)
        this.position += 8
        return ret
    }

    string() {
        const ret = []
        let c, i = -1
        c = this.uint16()
        while( c ) {
          ret[++i] = c
          c = this.uint16()
        }
        return String.fromCharCode.apply(null, ret)
    }
}

const TYPE_BY_NAME = {
    "bool": "bool",
    "byte": "byte",
    "int16": "int16",
    "uint16": "uint16",
    "int32": "int32",
    "uint32": "uint32",
    "float": "float",
    "int64": "int64",
    "uint64": "uint64",
    "double": "double",
    "vec3": "vec3",
    "vec3fa": "vec3fa",
    "angle": "angle",
    "skillid32": "skillid32",
    "skillid": "skillid",
    "customize": "customize",
    "string": "string",
    "bytes": "bytes",
    "array": "array",
    "object": "object"
};

const TYPES = Object.keys(TYPE_BY_NAME);

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

    static get Types() {
        return TYPE_BY_NAME;
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
		let value;
        let tmpPos = this.position;
        try {
            value = choose( type, this );
        } catch ( _ ) {
            // revert position if changed and skip unsupported types
            this.position = tmpPos;
            return;
        }
        let length = this.position - this.selectedPosition;
        this.position = this.selectedPosition;
        return { type, value, length };
    }

    tryAll( filter = () => true ) {
        let data = {};
        for ( let type of TYPES ) {
			let obj = this.try( type );
			if( obj && filter( obj ) ) 
				data[type] = obj;
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
