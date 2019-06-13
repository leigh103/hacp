const WebSocket = require('ws')
const request = require('request')
const fs = require('fs')
const method = require('./methods.js');

module.exports = {

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
