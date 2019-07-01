const fetchIssueCount = require('../../javascripts/fetchIssueCount');

describe('fetchIssueCount', function() {
  beforeEach(function() {
    fetch.resetMocks();
    localStorage.clear();
  });

  it('fetches the issue label URL of a GitHub project', function() {
    const oneItem = [{}];
    fetch.mockResponseOnce(JSON.stringify(oneItem), {
      status: 200,
      headers: [
        ['Content-Type', 'application/json'],
        ['ETag', 'a00049ba79152d03380c34652f2cb612'],
      ],
    });

    expect(fetchIssueCount('owner/repo', 'label')).resolves.toEqual(1);
  });

  it('uses the last Link header value and infers the issue count', function() {
    const oneItem = [{}];
    fetch.mockResponseOnce(JSON.stringify(oneItem), {
      status: 200,
      headers: [
        ['Content-Type', 'application/json'],
        ['ETag', 'a00049ba79152d03380c34652f2cb612'],
        [
          'Link',
          '<https://api.github.com/repositories/9891249/issues?label=help+wanted&page=2>; rel="next", <https://api.github.com/repositories/9891249/issues?label=help+wanted&page=7>; rel="last"',
        ],
      ],
    });

    // given a page of API results = N (30 by default)
    // the count of results = 6 * N < 7 pages <= 7 * N
    // this should be represented as an upper bound of the results
    expect(fetchIssueCount('xunit/xunit', 'help%20wanted')).resolves.toEqual(
      '180+'
    );
  });

  describe('local storage', function() {
    it('can retrieve issue count from local storage for the project', function() {
      const project = 'owner/project';

      const fourItems = [{}, {}, {}, {}];
      fetch.mockResponseOnce(JSON.stringify(fourItems), {
        status: 200,
      });

      const promise = fetchIssueCount(project, 'label');

      const cachedCount = promise.then(function() {
        const cached = localStorage.getItem(project);
        const obj = JSON.parse(cached);
        return obj.count;
      });

      expect(cachedCount).resolves.toEqual(4);
    });

    it('can retrieve ETag from local storage for the project', function() {
      const expectedEtag = 'a00049ba79152d03380c34652f2cb612';
      fetch.mockResponseOnce(JSON.stringify([]), {
        status: 200,
        headers: [['Content-Type', 'application/json'], ['ETag', expectedEtag]],
      });

      const project = 'owner/project';

      const promise = fetchIssueCount(project, 'label');

      const cachedEtag = promise.then(function() {
        const cached = localStorage.getItem(project);
        const obj = JSON.parse(cached);
        return obj.etag;
      });

      expect(cachedEtag).resolves.toEqual(expectedEtag);
    });

    it('can read a timestamp from local storage for the project', function() {
      fetch.mockResponseOnce(JSON.stringify([]), {
        status: 200,
      });

      const project = 'owner/project';

      const promise = fetchIssueCount(project, 'label');

      const cachedDate = promise.then(function() {
        const cached = localStorage.getItem(project);
        const obj = JSON.parse(cached);
        return obj.date;
      });

      expect(cachedDate).resolves.toMatch(
        /\d{4}-\d{2}-\d{2}T\d{2}\:\d{2}\:\d{2}\.\d{3}Z/
      );
    });
  });

  describe('caching', function() {
    it('does not make API call if cache is valid', function() {
      const project = 'owner/project';

      const now = new Date();
      const sixHoursAgo = now - 1000 * 60 * 60 * 6;

      localStorage.setItem(
        project,
        JSON.stringify({
          count: 6,
          date: sixHoursAgo,
        })
      );

      const promise = fetchIssueCount(project, 'label');

      expect(promise).resolves.toBe(6);
      expect(fetch.mock.calls).toHaveLength(0);
    });

    it('makes API call with etag if cache is considered expired', function() {
      const project = 'owner/project';
      const expectedEtag = 'a00049ba79152d03380c34652f2cb612';

      const now = new Date();
      const threeDaysAgo = now - 1000 * 60 * 60 * 72;

      localStorage.setItem(
        project,
        JSON.stringify({
          count: 6,
          etag: expectedEtag,
          date: threeDaysAgo,
        })
      );

      const fourItems = [{}, {}, {}, {}];
      fetch.mockResponseOnce(JSON.stringify(fourItems));

      const promise = fetchIssueCount(project, 'label');

      expect(promise).resolves.toBe(4);

      expect(fetch.mock.calls).toHaveLength(1);
      expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBe(
        expectedEtag
      );
    });

    it('handles 304 Not Modified and returns cached value', function() {
      const project = 'owner/project';
      const expectedEtag = 'a00049ba79152d03380c34652f2cb612';

      const now = new Date();
      const twoDaysAgo = now - 1000 * 60 * 60 * 48;

      localStorage.setItem(
        project,
        JSON.stringify({
          count: 3,
          etag: expectedEtag,
          date: twoDaysAgo,
        })
      );

      // ignore the JSON in the API response if a 304 is found
      fetch.mockResponseOnce(JSON.stringify({}), {
        status: 304,
        headers: [
          ['Content-Type', 'application/octet-stream'],
          ['ETag', 'a00049ba79152d03380c34652f2cb612'],
        ],
      });

      const promise = fetchIssueCount(project, 'label');

      expect(promise).resolves.toBe(3);
    });

    it('if 304 Not Modified is returned but nothing cached, returns zero', function() {
      const project = 'owner/project';

      // ignore the JSON in the API response if a 304 is found
      fetch.mockResponseOnce(JSON.stringify({}), {
        status: 304,
        headers: [
          ['Content-Type', 'application/octet-stream'],
          ['ETag', 'a00049ba79152d03380c34652f2cb612'],
        ],
      });

      const promise = fetchIssueCount(project, 'label');

      expect(promise).resolves.toBe(0);
    });

    it('updates cache if a 200 is received', function() {
      const project = 'owner/project';

      const now = new Date();
      const twoDaysAgo = now - 2 * (1000 * 60 * 60 * 24);

      localStorage.setItem(
        project,
        JSON.stringify({
          count: 3,
          date: twoDaysAgo,
        })
      );

      const fourItems = [{}, {}, {}, {}];
      fetch.mockResponseOnce(JSON.stringify(fourItems), {
        status: 200,
        headers: [['ETag', 'some-updated-value']],
      });

      const promise = fetchIssueCount(project, 'label');

      const cachedEtag = promise.then(function() {
        const cached = localStorage.getItem(project);
        const obj = JSON.parse(cached);
        return obj.etag;
      });

      expect(promise).resolves.toBe(4);
      expect(cachedEtag).resolves.toBe('some-updated-value');
    });
  });

  describe('error handling', function() {
    it('handles rate-limiting response and returns an error', function() {
      const rateLimitEpochSeconds = 1561912503;
      const rateLimitEpochDate = new Date(1000 * rateLimitEpochSeconds);

      fetch.mockResponseOnce(JSON.stringify([{ something: 'yes' }]), {
        status: 403,
        headers: [
          ['Content-Type', 'application/json'],
          ['X-RateLimit-Remaining', '0'],
          ['X-RateLimit-Reset', rateLimitEpochSeconds.toString()],
        ],
      });

      const expectedError = new Error(
        'GitHub rate limit met. Reset at ' +
          rateLimitEpochDate.toLocaleTimeString()
      );

      expect(fetchIssueCount('owner/repo', 'label')).rejects.toEqual(
        expectedError
      );
    });

    it.todo('rate-limit reset time is stored in local storage');

    it('no further API calls made after rate-limiting', function(done) {
      const anHourFromNowInTicks = Date.now() + 1000 * 60 * 60;
      const anHourFromNow = new Date(anHourFromNowInTicks);
      const anHourFromNowInSeconds = Math.floor(anHourFromNow.getTime() / 1000);

      fetch.mockResponseOnce(JSON.stringify([{ something: 'yes' }]), {
        status: 403,
        headers: [
          ['Content-Type', 'application/json'],
          ['X-RateLimit-Remaining', '0'],
          ['X-RateLimit-Reset', anHourFromNowInSeconds.toString()],
        ],
      });

      const makeRequestAndHandleError = function() {
        return fetchIssueCount('owner/repo', 'label').then(() => {}, () => {});
      };

      makeRequestAndHandleError()
        .then(() => makeRequestAndHandleError())
        .then(() => {
          expect(fetch.mock.calls).toHaveLength(1);
          done();
        });
    });

    it.todo('rate-limit reset time is cleared eventually');

    it('handles API error', function() {
      const message = 'The repository could not be found on the server';

      fetch.mockResponseOnce(
        JSON.stringify({
          message,
          documentation_url: 'https://developer.github.com/v3/#rate-limiting',
        }),
        {
          status: 404,
          headers: [['Content-Type', 'application/json']],
        }
      );

      const expectedError = new Error(
        'Could not get issue count from GitHub: ' + message
      );

      expect(fetchIssueCount('owner/repo', 'label')).rejects.toEqual(
        expectedError
      );
    });

    it('handles generic error', function() {
      fetch.mockResponseOnce(JSON.stringify({}), {
        status: 404,
        headers: [['Content-Type', 'application/json']],
      });

      const expectedError = new Error(
        'Could not get issue count from GitHub: Not Found'
      );

      expect(fetchIssueCount('owner/repo', 'label')).rejects.toEqual(
        expectedError
      );
    });
  });
});
