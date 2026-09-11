# TLS test fixture

`localhost-cert.pem` and `localhost-key.pem` are a deliberately public,
self-signed pair used only by the HTTPS and WSS integration tests. The private
key protects nothing: never trust or reuse it outside the test suite.

The test fixture is excluded from the published npm package and the final
container image. Its exact path is also excluded from GitHub secret scanning so
the intentional private-key marker does not create a false alert.
