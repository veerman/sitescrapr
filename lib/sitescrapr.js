var querystring = require('querystring');
var http = require('http');
var fs = require('fs');
var cheerio = require('cheerio');
var myAgent = new http.Agent({'maxSockets': 30});
var tracer = require('tracer').colorConsole({
	level: 'debug', // log, trace, debug, info, warn, error
	format: "{{timestamp}} <{{title}}> {{message}}",
	dateformat: "HH:MM:ss.L"
});
var url = require('url');

exports.sitescrapr = function sitescraper(params){
	var self = this;
	self.use_sleep = true;
	self.is_sleeping = false;
	self.request_cnt = 0;
	self.request_cnt_til_sleep = 5; // sleep every x requests
	self.sleep_cnt = 1000; // sleep time in ms
	self.request_timeout = 10000;
	self.links = {};
	self.request_params_default = {
		agent: myAgent,
	  method: 'GET',
	  port: 80
	};

	self.mergeParams = function(params){
		if (params === undefined)
			params = {};
		if (params.main === undefined)
			params.main = {};
		if (params.new !== undefined){
			for (var prop in params.new){
				params.main[prop] = params.new[prop];
			}
		}
		return params.main;
	}

	self.sleep = function(milliseconds){
		if (self.is_sleeping === false){ // sleeping has not started
			self.is_sleeping = true;
			tracer.info('Waiting for ' + milliseconds + ' milliseconds');
		  var start = new Date().getTime();
		  for (var i = 0; i < 1e7; i++){
		    if ((new Date().getTime() - start) > milliseconds){
		    	self.is_sleeping = false;
		      break;
		    }
		  }
		}
		else{ // sleeping has already started, wait for it to finish
			while(self.is_sleeping){};
		}
	}

	self.maybeSleep = function(){
		if (self.use_sleep === true){
			self.request_cnt++;
			if (self.request_cnt % self.request_cnt_til_sleep === 0)
				self.sleep(self.sleep_cnt);
		}
	}

	self.httpRequest = function(params){
		if (Object.keys(params.path_params).length > 0){ // append path_params to path if available
			params.request_params.path = params.request_params.path + (Object.keys(path_params).length > 0 ? '?' + querystring.stringify(path_params) : '')
		}
		tracer.debug(params.request_params.method + ' ' + params.request_params.path);
		var request = http.request(params.request_params, function(response){
			tracer.trace(request.method + ' returned ' + response.statusCode + ' for ' + request.path);
			response.setEncoding('utf8');
	    var return_params = {'request': {'method': response.req.method, 'path': response.req.path, 'headers': response.req._headers}, 'response': {'statusCode': response.statusCode, 'headers': response.headers}, 'params': params.params};
	    if (request.method === 'HEAD'){ // if request method was head execute callback immediately
	    	params.callback(return_params);
	    }
	    var body = [];
		  response.on('data', function(chunk){
		    body.push(chunk);
		  });
		  response.on('end', function(){
		  	if (response.statusCode === 200){
		  		return_params.body = body.join('');
		  		params.callback(return_params);
		  	}
		    else{
					self.writeFile({
						'filename': self.current_time + '_log.csv',
						'data': '"' + [request.path,response.statusCode].join('","') + '"' + "\n"
					});
				}
		  });
		});
		request.on('error', function(e){
		  tracer.error('Problem with ' + request.path + ' : ' + e.message);
		});
		request.setTimeout(self.request_timeout, function(){
			tracer.warn('Timeout for ' + request.path);
			self.writeFile({
				'filename': self.current_time + '_timeouts.csv',
				'data': request.path + "\n"
			});
			request.abort();
		});
		request.end();
		self.maybeSleep(); // sleep if necessary
	}

	self.getContent = function(params){
		var path_params = self.mergeParams({
			'main': self.path_params_default,
			'new': params.path_params
		});
		delete params.path_params;
		var request_params = self.mergeParams({
			'main': self.request_params_default,
			'new': params.request_params
		});
		delete params.request_params;

		var callback = params.callback;
		delete params.callback;

		self.httpRequest({
			'path_params': path_params,
			'request_params': request_params,
			'params': params,
			'callback': callback
		});
	}

	self.parseContent = function(params){
		tracer.log(params.body);
		$ = cheerio.load(params.body);
		delete params.body;

		params.callback({'params': params}); // '$': $,
	}

	self.cleanText = function(str){
		return str.replace(/(^,)|(,$)/g, '').replace(' , ',', ').replace(/\s+/g,' ').trim(); // trim trailing commas, fix space before comma, remove multiple whitespace
	}

	self.cleanObject = function(objectToClean){ // run cleanText on entire object
		switch(typeof objectToClean){
			case 'object':
				for (var prop in objectToClean)
					objectToClean[prop] = self.cleanObject(objectToClean[prop]);
			case 'array':
				for(var i = 0; i < objectToClean.length; i++)
					objectToClean[i] = self.cleanObject(objectToClean[i]);
				break;
			case 'string':
				objectToClean = self.cleanText(objectToClean);
				break;
		}
		return objectToClean;
	}

	self.currentDateTime = function(){
		return new Date().toISOString().
		replace(/:/g,'-').		// replace colon
	  replace(/T/g, '_').		// replace T with a space
	  replace(/\..+/g, '');	// delete the dot and everything after
	}

	self.writeFile = function(params){ // filename, data, overwrite, dir, callback
		params = self.mergeParams({'main': {'dir': './output/', 'overwrite': false, 'callback': function(){}}, 'new': params});
		if (params.overwrite === true){ // use write instead of append
			fs.writeFile(params.dir + params.filename, params.data, (err) => {
			  if (err){
			  	tracer.error(err);
			  };
			  params.callback();
			});
		}
		else{
			fs.appendFile(params.dir + params.filename, params.data, function (err){
			  if (err){
			  	tracer.error(err);
			  };
				params.callback();
			});
		}
	}

	self.readFile = function(params){ // filename, dir, callback
		params = self.mergeParams({'main': {'dir': './output/', 'callback': function(){}}, 'new': params});
		fs.readFile(params.dir + params.filename, 'utf8', (err, data) => {
		  if (err){
		  	tracer.error(err);
		  	data = '';
		  };
			params.callback({'data': data})
		});
	}

	self.parseCSV = function(params){
		params.data = params.data.replace(/[\n\r]/g, "\n"); // normalize newlines
		var data = {};
		(params.data.split("\n")).forEach(function(element, index, array) {
			var tmp = element.split(',');
			var k = tmp[0];
			var v = tmp.slice(1);
			if (k !== '')
				data[k] = v;
		});
		return data;
	}

	self.start = function(start_params){
		tracer.info('Current Time: ' + self.current_time);

		self.readFile({
			'filename': 'links.csv',
			'first_is_key': true,
			'callback': function(params){
				if (params.data !== ''){
					self.links = self.parseCSV(params);
				}

				start_params.callback();
			}
		});
	}

	self.init = function(params){
		for (var prop in params){
			if (typeof params[prop] === 'object'){
				self[prop] = self.mergeParams({'main': self[prop], 'new': params[prop]});
				delete params[prop];
			}
		}
		self = self.mergeParams({'main': self, 'new': params});

		self.current_time = self.currentDateTime();
	}
}