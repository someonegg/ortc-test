'use strict';

/**
 * Fill the given RTP parameters for the given track.
 *
 * @param {RTCRtpParameters} rtpParameters -  RTP parameters to be filled.
 * @param {Object} sdpObj - Local SDP Object generated by sdp-transform.
 * @param {MediaStreamTrack} track
 */
exports.fillRtpParametersForTrack = function(rtpParameters, sdpObj, track)
{
	const kind = track.kind;
	const rtcp =
	{
		cname       : null,
		reducedSize : true,
		mux         : true
	};

	const mSection = (sdpObj.media || [])
		.find((m) => m.type === kind);

	if (!mSection)
		throw new Error(`m=${kind} section not found`);

	// First media SSRC (or the only one).
	let firstSsrc;

	// Get all the SSRCs.

	const ssrcs = new Set();

	for (const line of mSection.ssrcs || [])
	{
		if (line.attribute !== 'msid')
			continue;

		const trackId = line.value.split(' ')[1];

		if (trackId === track.id)
		{
			const ssrc = line.id;

			ssrcs.add(ssrc);

			if (!firstSsrc)
				firstSsrc = ssrc;
		}
	}

	if (ssrcs.size === 0)
		throw new Error(`a=ssrc line not found for local track [track.id:${track.id}]`);

	// Get media and RTX SSRCs.

	const ssrcToRtxSsrc = new Map();

	// First assume RTX is used.
	for (const line of mSection.ssrcGroups || [])
	{
		if (line.semantics !== 'FID')
			continue;

		let [ ssrc, rtxSsrc ] = line.ssrcs.split(/\s+/);

		ssrc = Number(ssrc);
		rtxSsrc = Number(rtxSsrc);

		if (ssrcs.has(ssrc))
		{
			// Remove both the SSRC and RTX SSRC from the Set so later we know that they
			// are already handled.
			ssrcs.delete(ssrc);
			ssrcs.delete(rtxSsrc);

			// Add to the map.
			ssrcToRtxSsrc.set(ssrc, rtxSsrc);
		}
	}

	// If the Set of SSRCs is not empty it means that RTX is not being used, so take
	// media SSRCs from there.
	for (const ssrc of ssrcs)
	{
		// Add to the map.
		ssrcToRtxSsrc.set(ssrc, null);
	}

	// Get RTCP info.

	const ssrcCnameLine = mSection.ssrcs
		.find((line) =>
		{
			return (line.attribute === 'cname' && line.id === firstSsrc);
		});

	if (ssrcCnameLine)
		rtcp.cname = ssrcCnameLine.value;

	// Fill RTP parameters.

	rtpParameters.rtcp = rtcp;
	rtpParameters.encodings = [];

	const simulcast = ssrcToRtxSsrc.size > 1;
	const simulcastProfiles = [ 'low', 'medium', 'high' ];

	for (const [ ssrc, rtxSsrc ] of ssrcToRtxSsrc)
	{
		const encoding = { ssrc };

		if (rtxSsrc)
			encoding.rtx = { ssrc: rtxSsrc };

		if (simulcast)
			encoding.profile = simulcastProfiles.shift();

		rtpParameters.encodings.push(encoding);
	}
}

/**
 * Adds simulcast into the given SDP for the given track.
 *
 * @param {Object} sdpObj - Local SDP Object generated by sdp-transform.
 * @param {MediaStreamTrack} track
 */
exports.addSimulcastForTrack = function(sdpObj, track)
{
	const kind = track.kind;

	const mSection = (sdpObj.media || [])
		.find((m) => m.type === kind);

	if (!mSection)
		throw new Error(`m=${kind} section not found`);

	let ssrc;
	let rtxSsrc;
	let msid;

	// Get the SSRC.

	const ssrcMsidLine = (mSection.ssrcs || [])
		.find((line) =>
		{
			if (line.attribute !== 'msid')
				return false;

			const trackId = line.value.split(' ')[1];

			if (trackId === track.id)
			{
				ssrc = line.id;
				msid = line.value.split(' ')[0];

				return true;
			}
		});

	if (!ssrcMsidLine)
		throw new Error(`a=ssrc line not found for local track [track.id:${track.id}]`);

	// Get the SSRC for RTX.

	(mSection.ssrcGroups || [])
		.some((line) =>
		{
			if (line.semantics !== 'FID')
				return;

			const ssrcs = line.ssrcs.split(/\s+/);

			if (Number(ssrcs[0]) === ssrc)
			{
				rtxSsrc = Number(ssrcs[1]);

				return true;
			}
		});

	const ssrcCnameLine = mSection.ssrcs
		.find((line) =>
		{
			return (line.attribute === 'cname' && line.id === ssrc);
		});

	if (!ssrcCnameLine)
		throw new Error(`CNAME line not found for local track [track.id:${track.id}]`);

	const cname = ssrcCnameLine.value;
	const ssrc2 = ssrc + 1;
	const ssrc3 = ssrc + 2;

	mSection.ssrcGroups = mSection.ssrcGroups || [];

	mSection.ssrcGroups.push(
		{
			semantics : 'SIM',
			ssrcs     : `${ssrc} ${ssrc2} ${ssrc3}`
		});

	mSection.ssrcs.push(
		{
			id        : ssrc2,
			attribute : 'cname',
			value     : cname
		});

	mSection.ssrcs.push(
		{
			id        : ssrc2,
			attribute : 'msid',
			value     : `${msid} ${track.id}`
		});

	mSection.ssrcs.push(
		{
			id        : ssrc3,
			attribute : 'cname',
			value     : cname
		});

	mSection.ssrcs.push(
		{
			id        : ssrc3,
			attribute : 'msid',
			value     : `${msid} ${track.id}`
		});

	if (rtxSsrc)
	{
		const rtxSsrc2 = rtxSsrc + 1;
		const rtxSsrc3 = rtxSsrc + 2;

		mSection.ssrcGroups.push(
			{
				semantics : 'FID',
				ssrcs     : `${ssrc2} ${rtxSsrc2}`
			});

		mSection.ssrcs.push(
			{
				id        : rtxSsrc2,
				attribute : 'cname',
				value     : cname
			});

		mSection.ssrcs.push(
			{
				id        : rtxSsrc2,
				attribute : 'msid',
				value     : `${msid} ${track.id}`
			});

		mSection.ssrcGroups.push(
			{
				semantics : 'FID',
				ssrcs     : `${ssrc3} ${rtxSsrc3}`
			});

		mSection.ssrcs.push(
			{
				id        : rtxSsrc3,
				attribute : 'cname',
				value     : cname
			});

		mSection.ssrcs.push(
			{
				id        : rtxSsrc3,
				attribute : 'msid',
				value     : `${msid} ${track.id}`
			});
	}
}
