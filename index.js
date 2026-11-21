    // 3. /download request pampali
    const buzzRes = await gotScraping({
      url: `${buzzPageUrl}/download`,
      headers: {
        referer: buzzPageUrl,
        "hx-current-url": buzzPageUrl,
        "hx-request": "true",
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
      followRedirect: false,
      throwHttpErrors: false,
    });

    let directLink = buzzRes.headers["hx-redirect"] || buzzRes.headers["location"];

    // Okavela malli main page ke redirect chesthe debug info chupinchali
    if (!directLink || directLink.endsWith(`/${buzzId}`)) {
      return res.json({
        error: "Direct MP4 link raledu",
        status: buzzRes.statusCode,
        hxRedirect: buzzRes.headers["hx-redirect"] || null,
        location: buzzRes.headers["location"] || null,
      });
    }

    if (directLink.startsWith("/")) {
      directLink = `https://buzzheavier.com${directLink}`;
    }

    res.redirect(302, directLink);
