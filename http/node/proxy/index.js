const {setContentTypeByData,buildOptions,getNetworkForOptions} = require("../common");

function generateMethodForRequestViaProxy(httpMethod) {
	return function (proxyUrl, url, data, opts, callback) {

		const options = buildOptions(url, httpMethod, opts);

		setContentTypeByData(options, data);

		const urlModuleName = "url";
		const URL = require(urlModuleName);
		const proxyUrlObject = URL.parse(proxyUrl);

		const network = getNetworkForOptions(proxyUrlObject);

		const proxyPortToIncludeInPath = Number.isNaN(options.port) ? `` : `:${options.port}`
		const proxyPath = options.hostname + proxyPortToIncludeInPath;
		const proxyReq = network.request({
			host: proxyUrlObject.hostname,
			port: proxyUrlObject.port,
			method: 'CONNECT',
			path: proxyUrlObject.protocol + "//" + proxyPath
		});

		//setting up the listener for connect event
		proxyReq.on('connect', function (res, socket, head) {

			const connectMethod = proxyUrlObject.protocol === "http:" ? require("net").connect : require('tls').connect;

			let socketConnection = connectMethod({
				host: options.hostname,
				port: options.port,
				socket: socket
			}, function () {
				//now that we are connected to the proxy we need to prepare the request that needs to be done by the proxy for us
				let request = `${httpMethod} ${options.path} HTTP/1.1\r\nHost: ${options.hostname}\r\n`;
				//handling headers
				for (let headerName in options.headers) {
					let headerValue = options.headers[headerName];
					request += `${headerName}: ${headerValue}\r\n`;
				}

				socketConnection.write(request);

				//if data is stream
				if (data && data.pipe && typeof data.pipe === "function") {
					//we need to signal that the body of the request will be written
					socketConnection.write("\r\n");
					data.on("data", function (chunk) {
						socketConnection.write(chunk);
					});

					data.on("end", function () {
						socketConnection.write("\r\n");
					});
					return;
				}

				//if data is object we serialize it as JSON
				if (typeof data !== "undefined" && typeof data !== 'string' && !$$.Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
					//we need to signal that the body of the request will be written
					socketConnection.write("\r\n");
					socketConnection.write(JSON.stringify(data)+"\r\n");
					return;
				}

				//if buffer type just write it into the socket
				if (data) {
					//we need to signal that the body of the request will be written
					socketConnection.write("\r\n");
					socketConnection.write(data);
				}

				socketConnection.write("\r\n");
			});

			require("./responseParser.js")(socketConnection, (err, response)=>{
				if(err){
					return callback(err);
				}
				//not sure if we should treat redirects as errors...
				if (res.statusCode < 200 || res.statusCode >= 300){
					return callback(res);
				}
				//TODO: document the last argument... providing response.headers to the callback
				callback(undefined, response.body, response.headers);
			});
		});

		//make the request to the proxy
		proxyReq.end();
	}
}

function doGetWithProxy(proxyUrl, url, options, callback) {
	let fnc = generateMethodForRequestViaProxy('GET');
	return fnc(proxyUrl, url, undefined, options, callback);
}

module.exports = {
	doGetWithProxy,
	doPutWithProxy: generateMethodForRequestViaProxy('PUT'),
	doPostWithProxy: generateMethodForRequestViaProxy('POST')
}

