'use strict';

const utils = require('./utils');
const supportedRtpCapabilities = require('./supportedRtpCapabilities');

const DYNAMIC_PAYLOAD_TYPES =
[
	100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115,
	116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 96, 97, 98, 99, 77,
	78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 35, 36,
	37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56,
	57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71
];

/**
 * Generate RTP capabilities for the room based on the given media codecs and
 * mediasoup supported RTP capabilities. It may throw.
 *
 * @param {array<RoomMediaCodec>]} mediaCodecs
 *
 * @return {RTCRtpCapabilities}
 */
exports.generateRoomRtpCapabilities = function(mediaCodecs)
{
	if (!Array.isArray(mediaCodecs))
		throw new TypeError('mediaCodecs must be an Array');
	else if (mediaCodecs.length === 0)
		throw new TypeError('mediaCodecs cannot be empty');

	const supportedCodecs = supportedRtpCapabilities.codecs;
	const caps =
	{
		codecs           : [],
		headerExtensions : supportedRtpCapabilities.headerExtensions,
		fecMechanisms    : supportedRtpCapabilities.fecMechanisms
	};

	let dynamicPayloadTypeIdx = 0;

	for (const mediaCodec of mediaCodecs)
	{
		assertCodecCapability(mediaCodec);

		const matchedSupportedCodec = supportedCodecs
			.find((supportedCodec) =>
			{
				return matchCodecs(mediaCodec, supportedCodec);
			});

		if (!matchedSupportedCodec)
			throw new Error(`RoomMediaCodec not supported [name:${mediaCodec.name}]`);

		// Clone the supported codec.
		const codec = Object.assign({}, matchedSupportedCodec);

		// Normalize channels.
		if (codec.kind !== 'audio')
			delete codec.channels;
		else if (!codec.channels)
			codec.channels = 1;

		// Merge the media codec parameters.
		codec.parameters =
			Object.assign({}, codec.parameters, mediaCodec.parameters);

		// Ensure rtcpFeedback is an Array.
		codec.rtcpFeedback = codec.rtcpFeedback || [];

		// Assign a payload type.
		if (typeof codec.preferredPayloadType !== 'number')
		{
			const pt = DYNAMIC_PAYLOAD_TYPES[dynamicPayloadTypeIdx++];

			if (!pt)
				throw new Error('cannot allocate more dynamic codec payload types');

			codec.preferredPayloadType = pt;
		}

		// Append to the codec list.
		caps.codecs.push(codec);

		// Add a RTX video codec if video.
		if (codec.kind === 'video')
		{
			const pt = DYNAMIC_PAYLOAD_TYPES[dynamicPayloadTypeIdx++];

			if (!pt)
				throw new Error('cannot allocate more dynamic codec payload types');

			const rtxCodec =
			{
				kind                 : codec.kind,
				name                 : 'rtx',
				mimeType             : `${codec.kind}/rtx`,
				preferredPayloadType : pt,
				clockRate            : codec.clockRate,
				parameters           :
				{
					apt : codec.preferredPayloadType
				}
			};

			// Append to the codec list.
			caps.codecs.push(rtxCodec);
		}
	}

	return caps;
};

/**
 * Checks whether aCaps is a valid subset of bCaps. It throws otherwise.
 *
 * @param {RTCRtpCapabilities} aCaps
 * @param {RTCRtpCapabilities} bCaps
 */
exports.assertCapabilitiesSubset = function(aCaps, bCaps)
{
	for (const aCodec of aCaps.codecs)
	{
		const matchedBCodec = bCaps.codecs
			.find((bCodec) =>
			{
				return (
					aCodec.preferredPayloadType === bCodec.preferredPayloadType &&
					matchCodecs(aCodec, bCodec)
				);
			});

		if (!matchedBCodec)
		{
			throw new Error(
				'unsupported codec ' +
				`[name:${aCodec.name}, preferredPayloadType:${aCodec.preferredPayloadType}]`);
		}
	}

	for (const aExt of aCaps.headerExtensions)
	{
		const matchedBExt = bCaps.headerExtensions
			.find((bExt) =>
			{
				return (
					aExt.preferredId === bExt.preferredId &&
					matchHeaderExtensions(aExt, bExt)
				);
			});

		if (!matchedBExt)
		{
			throw new Error(
				`unsupported header extension [kind:${aExt.kind}, uri:${aExt.uri}]`);
		}
	}
};

/**
 * Generate a mapping of codec payload types and header extension ids that maps
 * the RTP parameters of a Producer and the associated values in the RTP
 * capabilities of the Room.
 * It may throw if invalid or non supported RTP parameters are given.
 *
 * @param {RTCRtpParameters} params
 * @param {RTCRtpCapabilities} caps
 *
 * @return {Object}
 */
exports.getProducerRtpParametersMapping = function(params, caps)
{
	const codecToCapCodec = new Map();

	// Match parameters media codecs to capabilities media codecs.
	for (const codec of params.codecs)
	{
		if (codec.name.toLowerCase() === 'rtx')
			continue;

		// Search for the same media codec in capabilities.
		const matchedCapCodec = caps.codecs
			.find((capCodec) => matchCodecs(codec, capCodec));

		if (!matchedCapCodec)
		{
			throw new Error(
				'unsupported codec ' +
				`[name:${codec.name}, payloadType:${codec.payloadType}]`);
		}

		codecToCapCodec.set(codec, matchedCapCodec);
	}

	// Match parameters RTX codecs to capabilities RTX codecs.
	for (const codec of params.codecs)
	{
		if (codec.name.toLowerCase() !== 'rtx')
			continue;

		// Search for the associated media codec in parameters.
		const associatedMediaCodec = params.codecs
			.find((mediaCodec) => mediaCodec.payloadType === codec.parameters.apt);

		const capMediaCodec = codecToCapCodec.get(associatedMediaCodec);

		if (!capMediaCodec)
		{
			throw new Error(
				`no media codec found for RTX PT ${codec.payloadType}`);
		}

		// Ensure that the capabilities media codec has a RTX codec.
		const associatedCapRtxCodec = caps.codecs
			.find((capCodec) =>
			{
				return (
					capCodec.name.toLowerCase() === 'rtx' &&
					capCodec.parameters.apt === capMediaCodec.preferredPayloadType
				);
			});

		if (!associatedCapRtxCodec)
		{
			throw new Error(
				'no RTX codec found in capabilities ' +
				`[capabilities codec PT:${capMediaCodec.preferredPayloadType}]`);
		}

		codecToCapCodec.set(codec, associatedCapRtxCodec);
	}

	const mapCodecPayloadTypes = new Map();

	for (const [ codec, capCodec ] of codecToCapCodec)
	{
		mapCodecPayloadTypes.set(codec.payloadType, capCodec.preferredPayloadType);
	}

	const mapHeaderExtensionIds = new Map();

	for (const ext of params.headerExtensions)
	{
		const matchedCapExt = caps.headerExtensions
			.find((capExt) => matchHeaderExtensions(ext, capExt));

		if (!matchedCapExt)
		{
			throw new Error(
				`unsupported header extensions [uri:"${ext.uri}", id:${ext.id}]`);
		}

		mapHeaderExtensionIds.set(ext.id, matchedCapExt.preferredId);
	}

	return {
		mapCodecPayloadTypes,
		mapHeaderExtensionIds
	};
};

/**
 * Generate RTP parameters for Consumers given the RTP parameters of a Producer
 * and the RTP capabilities of the Room.
 * It may throw if invalid or non supported RTP parameters are given.
 *
 * @param {RTCRtpParameters} params
 * @param {RTCRtpCapabilities} caps
 * @param {Object} rtpMapping - As generated by getProducerRtpParametersMapping().
 *
 * @return {RTCRtpParameters}
 */
exports.getConsumableRtpParameters = function(params, caps, rtpMapping)
{
	const { mapCodecPayloadTypes, mapHeaderExtensionIds } = rtpMapping;
	const consumableParams =
	{
		muxId            : params.muxId,
		codecs           : [],
		headerExtensions : [],
		encodings        : params.encodings,
		rtcp             : params.rtcp
	};

	for (const codec of params.codecs)
	{
		if (codec.name.toLowerCase() === 'rtx')
			continue;

		const consumableCodecPt = mapCodecPayloadTypes.get(codec.payloadType);

		if (!consumableCodecPt)
		{
			throw new Error(
				`codec payloadType mapping not found [name:${codec.name}]`);
		}

		const matchedCapCodec = caps.codecs
			.find((capCodec) => capCodec.preferredPayloadType === consumableCodecPt);

		if (!matchedCapCodec)
			throw new Error(`capabilities codec not found [name:${codec.name}]`);

		const consumableCodec =
		{
			name         : matchedCapCodec.name,
			mimeType     : matchedCapCodec.mimeType,
			clockRate    : matchedCapCodec.clockRate,
			payloadType  : matchedCapCodec.preferredPayloadType,
			channels     : matchedCapCodec.channels,
			rtcpFeedback : matchedCapCodec.rtcpFeedback,
			parameters   : matchedCapCodec.parameters
		};

		if (!consumableCodec.channels)
			delete consumableCodec.channels;

		consumableParams.codecs.push(consumableCodec);

		const consumableCapRtxCodec = caps.codecs
			.find((capRtxCodec) =>
			{
				return (
					capRtxCodec.name.toLowerCase() === 'rtx' &&
					capRtxCodec.parameters.apt === consumableCodec.payloadType
				);
			});

		if (consumableCapRtxCodec)
		{
			const consumableRtxCodec =
			{
				name         : consumableCapRtxCodec.name,
				mimeType     : consumableCapRtxCodec.mimeType,
				clockRate    : consumableCapRtxCodec.clockRate,
				payloadType  : consumableCapRtxCodec.preferredPayloadType,
				channels     : consumableCapRtxCodec.channels,
				rtcpFeedback : consumableCapRtxCodec.rtcpFeedback,
				parameters   : consumableCapRtxCodec.parameters
			};

			if (!consumableRtxCodec.channels)
				delete consumableRtxCodec.channels;

			consumableParams.codecs.push(consumableRtxCodec);
		}
	}

	for (const ext of params.headerExtensions)
	{
		const consumableExtId = mapHeaderExtensionIds.get(ext.id);

		if (!consumableExtId)
		{
			throw new Error(
				`extension header id mapping not found [uri:${ext.uri}]`);
		}

		const matchedCapExt = caps.headerExtensions
			.find((capExt) => capExt.preferredId === consumableExtId);

		if (!matchedCapExt)
			throw new Error(`capabilities header extension not found [uri:${ext.uri}]`);

		const consumableExt =
		{
			uri : matchedCapExt.uri,
			id  : matchedCapExt.preferredId
		};

		consumableParams.headerExtensions.push(consumableExt);
	}

	return consumableParams;
};

/**
 * Generate RTP parameters for a specific Consumer.
 *
 * NOTE: It's up to the remote Consumer to check the codecs and decide whether it
 * can enable this Consumer or not.
 *
 * @param {RTCRtpParameters} consumableRtpParameters - Consumable RTP parameters.
 * @param {RTCRtpCapabilities} rtpCapabilities - Peer RTP capabilities.
 *
 * @return {RTCRtpParameters}
 */
exports.getConsumerRtpParameters = function(consumableRtpParameters, rtpCapabilities)
{
	const consumerParams =
	{
		muxId            : consumableRtpParameters.muxId,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : consumableRtpParameters.rtcp
	};

	const consumableCodecs = utils.cloneObject(consumableRtpParameters.codecs);
	let rtxSupported = false;

	for (const codec of consumableCodecs)
	{
		const matchedCapCodec = rtpCapabilities.codecs
			.find((capCodec) => capCodec.preferredPayloadType === codec.payloadType);

		if (!matchedCapCodec)
			continue;

		// Reduce RTCP feedbacks.
		codec.rtcpFeedback = matchedCapCodec.rtcpFeedback;

		consumerParams.codecs.push(codec);

		if (!rtxSupported && codec.name.toLowerCase() === 'rtx')
			rtxSupported = true;
	}

	consumerParams.headerExtensions = consumableRtpParameters.headerExtensions
		.filter((ext) =>
		{
			return rtpCapabilities.headerExtensions
				.some((capExt) => capExt.preferredId === ext.id);
		});

	const consumerEncoding =
	{
		ssrc : utils.randomNumber()
	};

	if (rtxSupported)
	{
		consumerEncoding.rtx =
		{
			ssrc : utils.randomNumber()
		};
	}

	consumerParams.encodings.push(consumerEncoding);

	return consumerParams;
};

function assertCodecCapability(codec)
{
	const valid =
		(typeof codec === 'object' && !Array.isArray(codec)) &&
		(typeof codec.kind === 'string' && codec.kind) &&
		(typeof codec.name === 'string' && codec.name) &&
		(typeof codec.clockRate === 'number' && codec.clockRate);

	if (!valid)
		throw new TypeError('invalid RTCCodecCapability');
}

function matchCodecs(aCodec, bCodec)
{
	const aName = aCodec.name.toLowerCase();
	const bName = bCodec.name.toLowerCase();

	if (aCodec.kind && bCodec.kind && aCodec.kind !== bCodec.kind)
	{
		return false;
	}

	if (aName !== bName)
		return false;

	if (aCodec.clockRate !== bCodec.clockRate)
		return false;

	if (aCodec.channels !== bCodec.channels)
		return false;

	// Match H264 parameters.
	if (aName === 'h264')
	{
		const aPacketizationMode = (aCodec.parameters || {})['packetization-mode'] || 0;
		const bPacketizationMode = (bCodec.parameters || {})['packetization-mode'] || 0;

		if (aPacketizationMode !== bPacketizationMode)
			return false;
	}

	return true;
}

function matchHeaderExtensions(aExt, bExt)
{
	if (aExt.kind && bExt.kind && aExt.kind !== bExt.kind)
		return false;

	if (aExt.uri !== bExt.uri)
		return false;

	return true;
}


/**
 * Generate extended RTP capabilities for sending and receiving.
 *
 * @param {RTCRtpCapabilities} localCaps - Local capabilities.
 * @param {RTCRtpCapabilities} remoteCaps - Remote capabilities.
 *
 * @return {RTCExtendedRtpCapabilities}
 */
exports.getExtendedRtpCapabilities = function(localCaps, remoteCaps)
{
	const extendedCaps =
	{
		codecs           : [],
		headerExtensions : [],
		fecMechanisms    : []
	};

	// Match media codecs and keep the order preferred by remoteCaps.
	for (const remoteCodec of remoteCaps.codecs || [])
	{
		// TODO: Ignore pseudo-codecs and feature codecs.
		if (remoteCodec.name === 'rtx')
			continue;

		const matchingLocalCodec = (localCaps.codecs || [])
			.find((localCodec) => matchCapCodecs(localCodec, remoteCodec));

		if (matchingLocalCodec)
		{
			const extendedCodec =
			{
				name               : remoteCodec.name,
				mimeType           : remoteCodec.mimeType,
				kind               : remoteCodec.kind,
				clockRate          : remoteCodec.clockRate,
				sendPayloadType    : matchingLocalCodec.preferredPayloadType,
				sendRtxPayloadType : null,
				recvPayloadType    : remoteCodec.preferredPayloadType,
				recvRtxPayloadType : null,
				channels           : remoteCodec.channels,
				rtcpFeedback       : reduceRtcpFeedback(matchingLocalCodec, remoteCodec),
				parameters         : remoteCodec.parameters
			};

			if (!extendedCodec.channels)
				delete extendedCodec.channels;

			extendedCaps.codecs.push(extendedCodec);
		}
	}

	// Match RTX codecs.
	for (const extendedCodec of extendedCaps.codecs || [])
	{
		const matchingLocalRtxCodec = (localCaps.codecs || [])
			.find((localCodec) =>
			{
				return (
					localCodec.name === 'rtx' &&
					localCodec.parameters.apt === extendedCodec.sendPayloadType
				);
			});

		const matchingRemoteRtxCodec = (remoteCaps.codecs || [])
			.find((remoteCodec) =>
			{
				return (
					remoteCodec.name === 'rtx' &&
					remoteCodec.parameters.apt === extendedCodec.recvPayloadType
				);
			});

		if (matchingLocalRtxCodec && matchingRemoteRtxCodec)
		{
			extendedCodec.sendRtxPayloadType = matchingLocalRtxCodec.preferredPayloadType;
			extendedCodec.recvRtxPayloadType = matchingRemoteRtxCodec.preferredPayloadType;
		}
	}

	// Match header extensions.
	for (const remoteExt of remoteCaps.headerExtensions || [])
	{
		const matchingLocalExt = (localCaps.headerExtensions || [])
			.find((localExt) => matchCapHeaderExtensions(localExt, remoteExt));

		if (matchingLocalExt)
		{
			const extendedExt =
			{
				kind   : remoteExt.kind,
				uri    : remoteExt.uri,
				sendId : matchingLocalExt.preferredId,
				recvId : remoteExt.preferredId
			};

			extendedCaps.headerExtensions.push(extendedExt);
		}
	}

	return extendedCaps;
}

/**
 * Generate RTP capabilities for receiving media based on the given extended
 * RTP capabilities.
 *
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {RTCRtpCapabilities}
 */
exports.getRtpCapabilities = function(extendedRtpCapabilities)
{
	const caps =
	{
		codecs           : [],
		headerExtensions : [],
		fecMechanisms    : []
	};

	for (const capCodec of extendedRtpCapabilities.codecs)
	{
		const codec =
		{
			name                 : capCodec.name,
			mimeType             : capCodec.mimeType,
			kind                 : capCodec.kind,
			clockRate            : capCodec.clockRate,
			preferredPayloadType : capCodec.recvPayloadType,
			channels             : capCodec.channels,
			rtcpFeedback         : capCodec.rtcpFeedback,
			parameters           : capCodec.parameters
		};

		if (!codec.channels)
			delete codec.channels;

		caps.codecs.push(codec);

		// Add RTX codec.
		if (capCodec.recvRtxPayloadType)
		{
			const rtxCapCodec =
			{
				name                 : 'rtx',
				mimeType             : `${capCodec.kind}/rtx`,
				kind                 : capCodec.kind,
				clockRate            : capCodec.clockRate,
				preferredPayloadType : capCodec.recvRtxPayloadType,
				parameters           :
				{
					apt : capCodec.recvPayloadType
				}
			};

			caps.codecs.push(rtxCapCodec);
		}

		// TODO: In the future, we need to add FEC, CN, etc, codecs.
	}

	for (const capExt of extendedRtpCapabilities.headerExtensions)
	{
		const ext =
		{
			kind        : capExt.kind,
			uri         : capExt.uri,
			preferredId : capExt.recvId
		};

		caps.headerExtensions.push(ext);
	}

	caps.fecMechanisms = extendedRtpCapabilities.fecMechanisms;

	return caps;
}

/**
 * Get unsupported remote codecs.
 *
 * @param {RTCRtpCapabilities} remoteCaps - Remote capabilities.
 * @param {Array<Number>} mandatoryCodecPayloadTypes - List of codec PT values.
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {Boolean}
 */
exports.getUnsupportedCodecs = function(
	remoteCaps, mandatoryCodecPayloadTypes, extendedRtpCapabilities)
{
	// If not given just ignore.
	if (!Array.isArray(mandatoryCodecPayloadTypes))
		return [];

	const unsupportedCodecs = [];
	const remoteCodecs = remoteCaps.codecs;
	const supportedCodecs = extendedRtpCapabilities.codecs;

	for (const pt of mandatoryCodecPayloadTypes)
	{
		if (!supportedCodecs.some((codec) => codec.recvPayloadType === pt))
		{
			const unsupportedCodec = remoteCodecs
				.find((codec) => codec.preferredPayloadType === pt);

			if (!unsupportedCodec)
				throw new Error(`mandatory codec PT ${pt} not found in remote codecs`);

			unsupportedCodecs.push(unsupportedCodec);
		}
	}

	return unsupportedCodecs;
}

/**
 * Whether media can be sent based on the given RTP capabilities.
 *
 * @param {String} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {Boolean}
 */
exports.canSend = function(kind, extendedRtpCapabilities)
{
	return extendedRtpCapabilities.codecs.
		some((codec) => codec.kind === kind);
}

/**
 * Whether the given RTP parameters can be received with the given RTP
 * capabilities.
 *
 * @param {RTCRtpParameters} rtpParameters
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {Boolean}
 */
exports.canReceive = function(rtpParameters, extendedRtpCapabilities)
{
	if (rtpParameters.codecs.length === 0)
		return false;

	const firstMediaCodec = rtpParameters.codecs[0];

	return extendedRtpCapabilities.codecs
		.some((codec) => codec.recvPayloadType === firstMediaCodec.payloadType);
}

/**
 * Generate RTP parameters of the given kind for sending media.
 * Just the first media codec per kind is considered.
 * NOTE: muxId, encodings and rtcp fields are left empty.
 *
 * @param {kind} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {RTCRtpParameters}
 */
exports.getSendingRtpParameters = function(kind, extendedRtpCapabilities)
{
	const params =
	{
		muxId            : null,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	for (const capCodec of extendedRtpCapabilities.codecs)
	{
		if (capCodec.kind !== kind)
			continue;

		const codec =
		{
			name         : capCodec.name,
			mimeType     : capCodec.mimeType,
			clockRate    : capCodec.clockRate,
			payloadType  : capCodec.sendPayloadType,
			channels     : capCodec.channels,
			rtcpFeedback : capCodec.rtcpFeedback,
			parameters   : capCodec.parameters
		};

		if (!codec.channels)
			delete codec.channels;

		params.codecs.push(codec);

		// Add RTX codec.
		if (capCodec.sendRtxPayloadType)
		{
			const rtxCodec =
			{
				name        : 'rtx',
				mimeType    : `${capCodec.kind}/rtx`,
				clockRate   : capCodec.clockRate,
				payloadType : capCodec.sendRtxPayloadType,
				parameters  :
				{
					apt : capCodec.sendPayloadType
				}
			};

			params.codecs.push(rtxCodec);
		}

		// NOTE: We assume a single media codec plus an optional RTX codec for now.
		// TODO: In the future, we need to add FEC, CN, etc, codecs.
		break;
	}

	for (const capExt of extendedRtpCapabilities.headerExtensions)
	{
		if (capExt.kind && capExt.kind !== kind)
			continue;

		const ext =
		{
			uri : capExt.uri,
			id  : capExt.sendId
		};

		params.headerExtensions.push(ext);
	}

	return params;
}

/**
 * Generate RTP parameters of the given kind for receiving media.
 * All the media codecs per kind are considered. This is useful for generating
 * a SDP remote offer.
 * NOTE: muxId, encodings and rtcp fields are left empty.
 *
 * @param {String} kind
 * @param {RTCExtendedRtpCapabilities} extendedRtpCapabilities
 *
 * @return {RTCRtpParameters}
 */
exports.getReceivingFullRtpParameters = function(kind, extendedRtpCapabilities)
{
	const params =
	{
		muxId            : null,
		codecs           : [],
		headerExtensions : [],
		encodings        : [],
		rtcp             : {}
	};

	for (const capCodec of extendedRtpCapabilities.codecs)
	{
		if (capCodec.kind !== kind)
			continue;

		const codec =
		{
			name         : capCodec.name,
			mimeType     : capCodec.mimeType,
			clockRate    : capCodec.clockRate,
			payloadType  : capCodec.recvPayloadType,
			channels     : capCodec.channels,
			rtcpFeedback : capCodec.rtcpFeedback,
			parameters   : capCodec.parameters
		};

		if (!codec.channels)
			delete codec.channels;

		params.codecs.push(codec);

		// Add RTX codec.
		if (capCodec.recvRtxPayloadType)
		{
			const rtxCodec =
			{
				name        : 'rtx',
				mimeType    : `${capCodec.kind}/rtx`,
				clockRate   : capCodec.clockRate,
				payloadType : capCodec.recvRtxPayloadType,
				parameters  :
				{
					apt : capCodec.recvPayloadType
				}
			};

			params.codecs.push(rtxCodec);
		}

		// TODO: In the future, we need to add FEC, CN, etc, codecs.
	}

	for (const capExt of extendedRtpCapabilities.headerExtensions)
	{
		if (capExt.kind && capExt.kind !== kind)
			continue;

		const ext =
		{
			uri : capExt.uri,
			id  : capExt.recvId
		};

		params.headerExtensions.push(ext);
	}

	return params;
}

function matchCapCodecs(aCodec, bCodec)
{
	const aMimeType = aCodec.mimeType.toLowerCase();
	const bMimeType = bCodec.mimeType.toLowerCase();

	if (aMimeType !== bMimeType)
		return false;

	if (aCodec.clockRate !== bCodec.clockRate)
		return false;

	if (aCodec.channels !== bCodec.channels)
		return false;

	// Match H264 parameters.
	if (aMimeType === 'video/h264')
	{
		const aPacketizationMode = (aCodec.parameters || {})['packetization-mode'] || 0;
		const bPacketizationMode = (bCodec.parameters || {})['packetization-mode'] || 0;

		if (aPacketizationMode !== bPacketizationMode)
			return false;
	}

	return true;
}

function matchCapHeaderExtensions(aExt, bExt)
{
	if (aExt.kind && bExt.kind && aExt.kind !== bExt.kind)
		return false;

	if (aExt.uri !== bExt.uri)
		return false;

	return true;
}

function reduceRtcpFeedback(codecA, codecB)
{
	const reducedRtcpFeedback = [];

	for (const aFb of codecA.rtcpFeedback || [])
	{
		const matchingBFb = (codecB.rtcpFeedback || [])
			.find((bFb) =>
			{
				return (
					bFb.type === aFb.type &&
					bFb.parameter === aFb.parameter
				);
			});

		if (matchingBFb)
			reducedRtcpFeedback.push(matchingBFb);
	}

	return reducedRtcpFeedback;
}

