const WebSocket = require('ws')
const request = require('request')
const fs = require('fs')
const method = require('./methods.js');

module.exports = {

    init(scope, callback) {

        fs.readFile('./settings.json', function read(err, data) {
            if (err) {throw err;}
            scope.settings = JSON.parse(data);

            fs.readFile('./automations.json', function read(err, data) {

                if (err) {throw err;}

                if (data.length > 0){
                    scope.automations = JSON.parse(data);
                } else {
                    scope.automations = {};
                }

                fs.readFile('./devices.json', function read(err, data) {

                    if (err) {throw err;}

                    if (data.length > 0){
                        scope.devices = JSON.parse(data);
                    } else {
                        scope.devices = {};
                    }

                    fs.readFile('./alarm.json', function read(err, data) {

                        if (err) {throw err;}

                        if (data.length > 0){
                            scope.alarm = JSON.parse(data);
                        } else {
                            scope.alarm = {};
                        }

                        request({
                            method: 'GET',
                            url:'http://'+scope.settings.host+'/api/'+scope.settings.api_key
                        }, (error, request, body) => {

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

    socketConnect(scope, callback){

        if (scope.ws && scope.ws.close){
            scope.ws.close()
        }

        scope.ws = new WebSocket('ws://' + scope.settings.host + ':' + scope.settings.ws_port);

        scope.ws.onmessage = (msg) => {

            msg = JSON.parse(msg.data)


            // relay the deconz websocket events to the HACP clients


            if (msg.id){
                scope.emit(msg.r,msg.state,msg.id)
            } else {
                scope.emit(msg.r,msg.state)
            }

            scope.msg = msg

            if (msg.r == 'sensors'){


                // button, switch and motion sensor event automations


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
                    method.checkAutomation('s'+msg.id, msg_state)
                }


                // outside light level sensor automations


                var date_now = new Date()

                if (date_now - scope.daylight_sensor.lastupdated >= 900000){ // if the last update for dark/dim/bright/sunny was over 30 mins ago. Stops automations repeatedly triggering if the light level is bouncing

                    if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux <= scope.daylight_sensor.cutoff.dark && scope.daylight_sensor.state != 'dark'){

                        method.checkAutomation('daylight_dark')
                        scope.daylight_sensor.state = 'dark'
                        scope.daylight_sensor.lastupdated = new Date()

                    } else if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux > scope.daylight_sensor.cutoff.dark && msg.state.lux <= scope.daylight_sensor.cutoff.dim && scope.daylight_sensor.state != 'dim'){

                        method.checkAutomation('daylight_dim')
                        scope.daylight_sensor.state = 'dim'
                        scope.daylight_sensor.lastupdated = new Date()

                    } else if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux > scope.daylight_sensor.cutoff.dim && msg.state.lux <= scope.daylight_sensor.cutoff.bright && scope.daylight_sensor.state != 'bright'){

                        method.checkAutomation('daylight_bright')
                        scope.daylight_sensor.state = 'bright'
                        scope.daylight_sensor.lastupdated = new Date()

                    } else if (msg.id && msg.id == scope.daylight_sensor.id && msg.state && msg.state.lux && msg.state.lux > scope.daylight_sensor.cutoff.bright && scope.daylight_sensor.state != 'sunny'){

                        method.checkAutomation('daylight_sunny')
                        scope.daylight_sensor.state = 'sunny'
                        scope.daylight_sensor.lastupdated = new Date()

                    }

                }


                // using the inbuilt daylight sensor, trigger automations and set values based on the sun position


                if (msg.id && msg.id == '1'){

                    if (parseInt(msg.state.status) >= 130 && parseInt(msg.state.status) < 140 && scope.time.dawn === false){ // sunrise automation
                        scope.time.dawn = true
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = false
                        method.checkAutomation('dawn')
                    }

                    if (parseInt(msg.state.status) >= 140 && parseInt(msg.state.status) < 180 && scope.time.sunrise === false){ // sunrise automation
                        scope.time.dawn = true
                        scope.time.sunrise = true
                        scope.time.sunset = false
                        scope.time.dusk = false
                        method.checkAutomation('sunrise')
                    }

                    if (parseInt(msg.state.status) >= 180 && parseInt(msg.state.status) < 200 && scope.time.sunset === false){ // sunset automation
                        scope.time.dawn = true
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = false
                        method.checkAutomation('sunset')
                    }

                    if (parseInt(msg.state.status) >= 200 && parseInt(msg.state.status) < 230 && scope.time.dusk === false){ // sunset automation
                        scope.time.dawn = false
                        scope.time.sunrise = false
                        scope.time.sunset = true
                        scope.time.dusk = true
                        method.checkAutomation('dusk')
                    }


                }


                // trigger the alarm if a motion sensor is triggered, which is included in the currently armed alarm sensor group


                if (scope.alarm.armed === true && scope.alarm.sensors.length > 0){ // if the alarm has been armed

                    if (scope.alarm.sensors.indexOf(msg.id) !== -1){ // if the reporting sensor is in the current alarm sensor group

                        if (msg.state && msg.state.presence && msg.state.presence === true){ // if motion is detected trigger alarm
                            method.triggerAlarm()
                        }

                    }

                }

            }


            // if the websocket event is for an entity, update it's stored values. Also if a light bri or ct is changed, update the group too


            if (msg.state && scope[msg.r] && scope[msg.r][msg.id]){

                scope[msg.r][msg.id].state = Object.assign(scope[msg.r][msg.id].state, msg.state)

                if (msg.state.bri || msg.state.ct){
                    for (var i in scope.groups){
                        if (scope.groups[i] && scope.groups[i].lights.length > 0 && scope.groups[i].lights.indexOf(msg.id)>=0){
                            scope.groups[i].action = Object.assign(scope.groups[i].action, msg.state)
                            scope.emit('groups',JSON.stringify(msg.state),i,'action')
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
        }, (error, request, body) => {

            if (body){
                scope.weather = JSON.parse(body)
                scope.emit('weather',scope.weather)

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

        if (scope[filename].length > 0 || Object.keys(scope[filename]).length > 0){

            fs.writeFile('./'+filename+'.json', JSON.stringify(scope[filename]), function read(err, data) {
                if (err) {throw err;}
                if (callback){
                    callback('ok')
                }
            });

        }

    }

}
