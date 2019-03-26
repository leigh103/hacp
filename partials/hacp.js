const WebSocket = require('ws')
const request = require('request')
const fs = require('fs')

module.exports = {

    init(scope, callback) {

        fs.readFile('./settings.json', function read(err, data) {
            if (err) {throw err;}
            scope.settings = JSON.parse(data);

            fs.readFile('./automations.json', function read(err, data) {
                if (err) {throw err;}
                scope.automations = JSON.parse(data);

                fs.readFile('./devices.json', function read(err, data) {
                    if (err) {throw err;}
                    scope.devices = JSON.parse(data);

                    fs.readFile('./alarm.json', function read(err, data) {
                        if (err) {throw err;}
                        scope.alarm = JSON.parse(data);

                        request({
                            method: 'GET',
                            url:'http://'+scope.settings.host+'/api/'+scope.settings.api_key
                        }, function (error, request, body) {

                            if (typeof body == 'string' && body.length>0){
                                body = JSON.parse(body)
                            } else {
                                body = {}
                            }


                            scope.groups = body.groups
                            scope.lights = body.lights
                            scope.sensors = body.sensors

                            if (scope.sensors[1] && scope.sensors[1].state && scope.sensors[1].state.status) { // set the time.sunset state if it doesn't exist
                                if (parseInt(scope.sensors[1].state.status) >= 180){
                                    scope.time.sunset = true
                                } else if (parseInt(scope.sensors[1].state.status) >= 140 && parseInt(scope.sensors[1].state.status) < 180) {
                                    scope.time.sunset = false
                                }
                            }

                            if (callback){
                                if (body.length>0 && body[0].description){
                                    callback(body[0].description)
                                } else {
                                    callback(scope)
                                }
                            }

                        }) // API call

                    }) // alarm

                }) // devices

            }) // automations

        }) // settings

    },

    socketConnect(scope, func, callback){

        if (func.ws){
            func.ws.close()
        }

        func.ws = new WebSocket('ws://' + scope.settings.host + ':' + scope.settings.ws_port);

        func.ws.onmessage = function(msg) {

            msg = JSON.parse(msg.data)

            if (msg.id){
                func.emit(msg.r,msg.state,msg.id)
            } else {
                func.emit(msg.r,msg.state)
            }

            scope.msg = msg

            if (msg.r == 'sensors'){

                if (msg.state){
                    if (msg.state.buttonevent){
                        var msg_state = 'v'+msg.state.buttonevent
                    }
                    if (msg.state.presence){
                        var msg_state = 'p'+msg.state.presence
                    }
                    if (msg.state.lux){
                        var msg_state = 'l'+msg.state.lux
                    }
                    if (msg.state.daylight){
                        var msg_state = 'daylight'
                    }
                }

                if (msg_state != 'daylight' || msg_state == 'daylight' && msg.state.daylight != scope.sensors['1'].state.daylight){ // only trigger the daylight sensor automations on change
                    func.checkAutomation('s'+msg.id, msg_state)
                }


                if (msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux){
                    console.log(msg.id, scope.daylight_sensor.id , msg.state , msg.state.lux , scope.daylight_sensor.cutoff.dim, scope.daylight_sensor.state)
                }


                if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux <= scope.daylight_sensor.cutoff.dim && scope.daylight_sensor.state != 'dim'){
                    console.log('Running Dim')
                    func.checkAutomation('daylight_dim')
                    scope.daylight_sensor.state = 'dim'

                } else if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux > scope.daylight_sensor.cutoff.dim && msg.state.lux <= scope.daylight_sensor.cutoff.bright && scope.daylight_sensor.state != 'bright'){
console.log('Running Bright')
                    func.checkAutomation('daylight_bright')
                    scope.daylight_sensor.state = 'bright'

                } else if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux > scope.daylight_sensor.cutoff.bright && scope.daylight_sensor.state != 'sunny'){
console.log('Running Sunny')
                    func.checkAutomation('daylight_sunny')
                    scope.daylight_sensor.state = 'sunny'

                }

                if (msg.id && msg.id == '1'){

                    if (parseInt(msg.state.status) >= 130 && parseInt(msg.state.status) < 140 && scope.time.dawn === false){ // sunrise automation
                        scope.time.dawn = true
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = false
                        func.checkAutomation('dawn')
                    }

                    if (parseInt(msg.state.status) >= 140 && parseInt(msg.state.status) < 180 && scope.time.sunrise === false){ // sunrise automation
                        scope.time.dawn = true
                        scope.time.sunrise = true
                        scope.time.sunset = false
                        scope.time.dusk = false
                        func.checkAutomation('sunrise')
                    }

                    if (parseInt(msg.state.status) >= 180 && parseInt(msg.state.status) < 200 && scope.time.sunset === false){ // sunset automation
                        scope.time.dawn = true
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = false
                        func.checkAutomation('sunset')
                    }

                    if (parseInt(msg.state.status) >= 200 && parseInt(msg.state.status) < 230 && scope.time.dusk === false){ // sunset automation
                        scope.time.dawn = false
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = true
                        func.checkAutomation('dusk')
                    }


                }

                if (scope.alarm.armed === true && scope.alarm.sensors.length > 0){ // if the alarm has been armed

                    if (scope.alarm.sensors.indexOf(msg.id) !== -1){ // if the reporting sensor is in the current alarm sensor group

                        if (msg.state && msg.state.presence && msg.state.presence === true){ // if motion is detected trigger alarm
                            func.triggerAlarm()
                        }

                    }

                }

            }

            if (msg.state && scope[msg.r] && scope[msg.r][msg.id]){

                scope[msg.r][msg.id].state = Object.assign(scope[msg.r][msg.id].state, msg.state)

                if (msg.state.bri || msg.state.ct){
                    for (var i in scope.groups){
                        if (scope.groups[i] && scope.groups[i].lights.length > 0 && scope.groups[i].lights.indexOf(msg.id)>=0){
                            scope.groups[i].action = Object.assign(scope.groups[i].action, msg.state)
                            func.emit('groups',JSON.stringify(msg.state),i,'action')
                        }
                        if (i > Object.keys(scope.groups).length){
                            break;
                        }
                    }
                }

            }

            if (msg.name && scope[msg.r] && scope[msg.r][msg.id]){

                scope[msg.r][msg.id].name = msg.name

            }

        }

        if (callback){
            return callback(scope)
        }

    },

    apiCall(url, data, scope, callback){

        var method = 'PUT'
        if (data.method){
            method = data.method
            delete data.method
        }

        if (data.bri || data.ct){
            data.on = true
        }

        request({
            method: method,
            url: 'http://'+scope.host+'/api/'+scope.api_key+'/'+url,
            body: JSON.stringify(data)
        }, function (error, request, body) {

            if (callback){
                body = JSON.parse(body)

                if (body.length>0 && body[0].description){
                    callback(body[0].description)
                } else if (method == 'get'){
                    callback(body)
                } else {
                    callback(200)
                }
            }

        })

    },

    audioCall(url, data, scope, callback){

        var method = 'GET'

        data = data.replace(/’/g,"'")

        request({
            method: method,
            url: 'http://'+scope.audio_host+':'+scope.audio_host_port+'/'+url+'/'+data
        }, function (error, request, body) {

            if (callback){
                callback(error,body)
            }

        })

    },

    getWeather(scope, func, callback){

        request({
            method: 'GET',
            url: 'https://api.darksky.net/forecast/18f56dfc0f212d31031ff29075c57aca/53.472,-2.139?units=uk2'
        }, function(error, request, body){

            if (body){
                scope.weather = JSON.parse(body)
                func.emit('weather',scope.weather)

                if (callback){
                    callback(JSON.parse(body))
                }

            } else {
                if (callback){
                    callback('')
                }
            }


        })

    },

    save(filename, scope, callback){

        fs.writeFile('./'+filename+'.json', JSON.stringify(scope[filename]), function read(err, data) {
            if (err) {throw err;}
            if (callback){
                callback('ok')
            }
        });

    }

}
