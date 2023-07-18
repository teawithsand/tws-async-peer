# tws-filesend

Library and deployed web application using it, which allows for transferring files between devices. 

tws-filesend works on top of [peerjs](https://www.npmjs.com/package/peerjs) and provides both handling code as well as gui for operating on files. Similarly to [qr-scanner](https://www.npmjs.com/package/qr-scanner) package, with the exception that this library provides different feature.

## How does it work?

From user perspective:
1. Sending party picks files that they want to send.
1. One party(either receiving or sending) generates token.
1. Second party somehow receives that token, either via string, scanning QRCode (or external not implemented source)
1. Both parties accept each other and files are streamed over WebRTC connection from sender to receiver.
1. User either saves(AKA downloads; we are in web world) those files, or programmer does something fancy with them.

In case you need more detailed info, check out the docs available directly with code.

## A few notes at the end

### It uses my homegrown event busses, which are so-so but work more than OK
This library uses EventBus from `tws-lts`, because it was first built on top of `tws-stl` in `tws-libs`. It's something like ~100sloc implementation of RxJS, but it's quite convenient to use nevertheless. 

There is nothing wrong in this lib using my own implementation of event bus for handling events, but IMHO it's kind of unsound of me to reinvent the wheel. Just check out the docs for [tws-lts](https://github.com/teawithsand/tws-lts).

Also if you use `react`, check out [tws-lts-react](https://github.com/teawithsand/tws-lts-react), which provides some neat hooks, which make it really easy to hook to busses and especially sticky busses. <!-- TODO: link here to tws-lts-react -->

### It's tied to peerjs

But at the beginning it was not supposed to be that way. It's possible to quite easily(like two to three evenings of work) to detach it from peerjs, but I won't do it, because why would I do it.

Main reason I didn't do that was that I do not know where is the boundary between PeerJS and non-peerjs stuff.