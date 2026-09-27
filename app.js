/* =========================================================
   HALL BLOOD DONOR
   Public Donor Directory
   Supabase + Robust Filtering + 3 Month Eligibility
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     ELEMENTS
     ========================================================= */

  const $ = (id) => document.getElementById(id);

  const bloodEl = $("blood");
  const cityEl = $("city");
  const locationEl = $("location");
  const statusEl = $("status");
  const sortEl = $("sort");
  const resultsEl = $("results");
  const countEl = $("count");


  /* =========================================================
     SAFE TEXT
     ========================================================= */

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  /* =========================================================
     NORMALIZATION
     ========================================================= */

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }


  function textMatches(filterValue, donorValue) {
    const filter = normalize(filterValue);
    const donor = normalize(donorValue);

    if (!filter) return true;
    if (!donor) return false;

    return donor.includes(filter);
  }


  /* =========================================================
     DATE HELPERS
     ========================================================= */

  function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      const copy = new Date(value.getTime());

      return Number.isNaN(copy.getTime())
        ? null
        : copy;
    }

    const raw = String(value).trim();

    if (!raw) return null;


    /*
      Supabase DATE format:
      YYYY-MM-DD
    */

    const isoDate =
      raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

    if (isoDate) {
      const year = Number(isoDate[1]);
      const month = Number(isoDate[2]) - 1;
      const day = Number(isoDate[3]);

      const date = new Date(
        Date.UTC(year, month, day)
      );

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }


    /*
      ISO timestamp:
      YYYY-MM-DDTHH:mm:ss...
    */

    const isoTimestamp =
      raw.match(
        /^(\d{4})-(\d{1,2})-(\d{1,2})T/
      );

    if (isoTimestamp) {
      const year = Number(isoTimestamp[1]);
      const month = Number(isoTimestamp[2]) - 1;
      const day = Number(isoTimestamp[3]);

      const date = new Date(
        Date.UTC(year, month, day)
      );

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }


    /*
      MM/DD/YYYY
    */

    const slashDate =
      raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (slashDate) {
      const month = Number(slashDate[1]) - 1;
      const day = Number(slashDate[2]);
      const year = Number(slashDate[3]);

      const date = new Date(
        Date.UTC(year, month, day)
      );

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }


    /*
      Final fallback
    */

    const fallback = new Date(raw);

    return Number.isNaN(fallback.getTime())
      ? null
      : fallback;
  }


  function formatDate(value) {
    const date = parseDate(value);

    if (!date) {
      return "Not specified";
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  }


  /* =========================================================
     TODAY
     ========================================================= */

  function todayUTC() {
    const now = new Date();

    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
      )
    );
  }


  /* =========================================================
     3 MONTH ELIGIBILITY
     ========================================================= */

  function eligibilityDate(lastDonation) {
    const donationDate =
      parseDate(lastDonation);

    if (!donationDate) {
      return null;
    }

    return new Date(
      Date.UTC(
        donationDate.getUTCFullYear(),
        donationDate.getUTCMonth() + 3,
        donationDate.getUTCDate()
      )
    );
  }


  /* =========================================================
     AVAILABLE FROM DATE
     ========================================================= */

  function effectiveAvailableDate(donor) {

    /*
      If last donation exists,
      the real availability date is:

      last donation + 3 calendar months
    */

    if (donor.last_donation) {
      const eligible =
        eligibilityDate(
          donor.last_donation
        );

      if (eligible) {
        return eligible;
      }
    }


    /*
      If there is no last donation,
      use available_from if present.
    */

    if (donor.available_from) {
      return parseDate(
        donor.available_from
      );
    }


    return null;
  }


  /* =========================================================
     BOOLEAN / AVAILABILITY VALUE
     ========================================================= */

  function toBoolean(value) {

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    const valueNormalized =
      normalize(value);

    if (
      valueNormalized === "true" ||
      valueNormalized === "yes" ||
      valueNormalized === "available" ||
      valueNormalized === "1"
    ) {
      return true;
    }

    if (
      valueNormalized === "false" ||
      valueNormalized === "no" ||
      valueNormalized === "unavailable" ||
      valueNormalized === "0" ||
      valueNormalized === ""
    ) {
      return false;
    }

    return false;
  }


  /* =========================================================
     EFFECTIVE AVAILABILITY
     ========================================================= */

  function effectiveAvailable(donor) {

    /*
      RULE 1
      If last_donation exists,
      it is the primary source.

      last donation + 3 months <= today
      => AVAILABLE

      otherwise
      => UNAVAILABLE
    */

    if (donor.last_donation) {

      const eligible =
        eligibilityDate(
          donor.last_donation
        );

      if (eligible) {

        return (
          eligible.getTime() <=
          todayUTC().getTime()
        );
      }
    }


    /*
      RULE 2
      If there is no valid last_donation,
      use available_from if possible.
    */

    if (donor.available_from) {

      const availableFrom =
        parseDate(
          donor.available_from
        );

      if (availableFrom) {

        return (
          availableFrom.getTime() <=
          todayUTC().getTime()
        );
      }
    }


    /*
      RULE 3
      Finally use the admin's
      available field.
    */

    return toBoolean(
      donor.available
    );
  }


  /* =========================================================
     SUPABASE CONFIG
     ========================================================= */

  function getConfigValue(names) {

    for (const name of names) {

      if (
        typeof window[name] !== "undefined" &&
        window[name] !== null &&
        window[name] !== ""
      ) {
        return window[name];
      }
    }

    return "";
  }


  function createClient() {

    if (
      !window.supabase ||
      typeof window.supabase.createClient !==
        "function"
    ) {
      throw new Error(
        "Supabase library could not be loaded."
      );
    }


    const url =
      getConfigValue([
        "SUPABASE_URL",
        "supabaseUrl",
        "SUPABASE_PROJECT_URL",
        "PROJECT_URL"
      ]);


    const key =
      getConfigValue([
        "SUPABASE_ANON_KEY",
        "SUPABASE_KEY",
        "supabaseAnonKey",
        "ANON_KEY",
        "PUBLIC_SUPABASE_ANON_KEY"
      ]);


    if (!url || !key) {
      throw new Error(
        "Supabase configuration was not found. Check config.js."
      );
    }


    return window.supabase.createClient(
      url,
      key
    );
  }


  /* =========================================================
     SUPABASE STATE
     ========================================================= */

  let supabaseClient = null;

  let allDonors = [];


  /* =========================================================
     LOAD DONORS
     ========================================================= */

  async function loadDonors() {

    try {

      if (!supabaseClient) {
        supabaseClient =
          createClient();
      }


      console.log(
        "Loading donors from Supabase..."
      );


      const {
        data,
        error
      } =
        await supabaseClient
          .from("donors")
          .select("*");


      if (error) {
        throw error;
      }


      allDonors =
        Array.isArray(data)
          ? data
          : [];


      console.log(
        "Donors loaded:",
        allDonors
      );


      populateCities(
        allDonors
      );


      render();

    } catch (error) {

      console.error(
        "Could not load donors:",
        error
      );


      if (countEl) {
        countEl.textContent =
          "0 donors";
      }


      if (resultsEl) {

        resultsEl.innerHTML = `
          <div class="empty-state">
            <strong>Could not load donors.</strong>
            <p>
              Please check Supabase configuration,
              table name, and Row Level Security.
            </p>
          </div>
        `;
      }
    }
  }


  /* =========================================================
     CITY DROPDOWN
     ========================================================= */

  function populateCities(donors) {

    if (!cityEl) {
      return;
    }


    const currentValue =
      cityEl.value;


    /*
      Get cities from database.
      Duplicate cities are removed
      using normalized values.
    */

    const cityMap =
      new Map();


    donors.forEach((donor) => {

      const original =
        String(
          donor.city ?? ""
        ).trim();


      if (!original) {
        return;
      }


      const normalized =
        normalize(original);


      if (!cityMap.has(normalized)) {
        cityMap.set(
          normalized,
          original
        );
      }
    });


    const cities =
      Array.from(
        cityMap.values()
      ).sort(
        (a, b) =>
          a.localeCompare(b)
      );


    /*
      Rebuild dropdown
    */

    cityEl.innerHTML = "";


    const allOption =
      document.createElement(
        "option"
      );

    allOption.value = "";

    allOption.textContent =
      "All locations";

    cityEl.appendChild(
      allOption
    );


    cities.forEach((city) => {

      const option =
        document.createElement(
          "option"
        );

      option.value = city;

      option.textContent = city;

      cityEl.appendChild(
        option
      );
    });


    /*
      Restore previous selection
    */

    const currentNormalized =
      normalize(currentValue);


    const matchingCity =
      cities.find(
        (city) =>
          normalize(city) ===
          currentNormalized
      );


    cityEl.value =
      matchingCity || "";
  }


  /* =========================================================
     FILTER DONORS
     ========================================================= */

  function filteredDonors() {

    const blood =
      normalize(
        bloodEl?.value
      );


    const city =
      normalize(
        cityEl?.value
      );


    const location =
      normalize(
        locationEl?.value
      );


    const status =
      normalize(
        statusEl?.value
      );


    const list =
      allDonors.filter(
        (donor) => {

          /*
            -----------------------------------
            BLOOD GROUP
            -----------------------------------
          */

          const donorBlood =
            normalize(
              donor.blood_group ??
              donor.blood
            );


          if (
            blood &&
            donorBlood !== blood
          ) {
            return false;
          }


          /*
            -----------------------------------
            CITY
            -----------------------------------
          */

          const donorCity =
            normalize(
              donor.city
            );


          if (
            city &&
            !textMatches(
              city,
              donorCity
            )
          ) {
            return false;
          }


          /*
            -----------------------------------
            SPECIFIC LOCATION
            -----------------------------------

            Optional.

            Example:
            Dhaka
            + Zahurul Huq Hall

            will show only Zahurul Huq Hall.

            If empty:
            all donors from selected city
            are allowed.
          */

          const donorLocation =
            normalize(
              donor.location
            );


          if (
            location &&
            !textMatches(
              location,
              donorLocation
            )
          ) {
            return false;
          }


          /*
            -----------------------------------
            AVAILABILITY
            -----------------------------------
          */

          const available =
            effectiveAvailable(
              donor
            );


          /*
            Available selected
          */

          if (
            status === "available" &&
            !available
          ) {
            return false;
          }


          /*
            Unavailable selected
          */

          if (
            status === "unavailable" &&
            available
          ) {
            return false;
          }


          /*
            All selected
            => don't filter by availability
          */


          return true;
        }
      );


    /* =======================================================
       SORT
       ======================================================= */

    const sort =
      sortEl?.value ||
      "available";


    /*
      AVAILABLE FIRST
    */

    if (
      sort === "available"
    ) {

      list.sort(
        (a, b) => {

          const aAvailable =
            effectiveAvailable(a)
              ? 0
              : 1;


          const bAvailable =
            effectiveAvailable(b)
              ? 0
              : 1;


          if (
            aAvailable !==
            bAvailable
          ) {
            return (
              aAvailable -
              bAvailable
            );
          }


          /*
            Same availability:
            sort by name.
          */

          return normalize(
            a.name
          ).localeCompare(
            normalize(b.name)
          );
        }
      );
    }


    /*
      BLOOD GROUP
    */

    else if (
      sort === "blood"
    ) {

      list.sort(
        (a, b) => {

          const bloodA =
            normalize(
              a.blood_group ??
              a.blood
            );


          const bloodB =
            normalize(
              b.blood_group ??
              b.blood
            );


          return bloodA.localeCompare(
            bloodB
          );
        }
      );
    }


    /*
      LOCATION
    */

    else if (
      sort === "location"
    ) {

      list.sort(
        (a, b) => {

          const locationA =
            normalize(
              `${a.city ?? ""} ${
                a.location ?? ""
              }`
            );


          const locationB =
            normalize(
              `${b.city ?? ""} ${
                b.location ?? ""
              }`
            );


          return locationA.localeCompare(
            locationB
          );
        }
      );
    }


    /*
      RECENTLY VERIFIED
    */

    else if (
      sort === "recent"
    ) {

      list.sort(
        (a, b) => {

          const dateA =
            parseDate(
              a.verified_at
            )?.getTime() || 0;


          const dateB =
            parseDate(
              b.verified_at
            )?.getTime() || 0;


          return dateB - dateA;
        }
      );
    }


    return list;
  }


  /* =========================================================
     DONOR CARD
     ========================================================= */

  function donorCard(donor) {

    const name =
      escapeHtml(
        donor.name ||
        "Unnamed donor"
      );


    const blood =
      escapeHtml(
        donor.blood_group ??
        donor.blood ??
        "—"
      );


    const city =
      escapeHtml(
        donor.city ||
        "—"
      );


    const location =
      escapeHtml(
        donor.location ||
        "Not specified"
      );


    const available =
      effectiveAvailable(
        donor
      );


    const statusClass =
      available
        ? "available"
        : "unavailable";


    const statusText =
      available
        ? "Available"
        : "Unavailable";


    const lastDonation =
      formatDate(
        donor.last_donation
      );


    const availableDate =
      effectiveAvailableDate(
        donor
      );


    const availableFrom =
      availableDate
        ? formatDate(
            availableDate
          )
        : "Not specified";


    const verified =
      formatDate(
        donor.verified_at
      );


    const phone =
      String(
        donor.phone ?? ""
      ).trim();


    let contactButton;


    if (phone) {

      contactButton =
        `
        <a
          class="contact-btn"
          href="tel:${escapeHtml(phone)}"
        >
          Contact donor
        </a>
        `;

    } else {

      contactButton =
        `
        <button
          class="contact-btn"
          type="button"
          disabled
        >
          Contact donor
        </button>
        `;
    }


    return `
      <article class="donor-card">

        <div class="donor-card-head">

          <h3>
            ${name}
          </h3>

          <strong class="blood-badge">
            ${blood}
          </strong>

        </div>


        <span
          class="status ${statusClass}"
        >
          ${statusText}
        </span>


        <div class="donor-location">
          📍 ${city} • ${location}
        </div>


        <div class="donor-date">
          🩸 Last donation:
          ${lastDonation}
        </div>


        <div class="donor-available">
          📅 Available from:
          ${availableFrom}
        </div>


        <div class="donor-verified">
          🛡️ Verified:
          ${verified}
        </div>


        ${contactButton}

      </article>
    `;
  }


  /* =========================================================
     RENDER
     ========================================================= */

  function render() {

    if (!resultsEl) {
      return;
    }


    const donors =
      filteredDonors();


    /*
      Counter
    */

    if (countEl) {

      countEl.textContent =
        `${donors.length} ${
          donors.length === 1
            ? "donor"
            : "donors"
        }`;
    }


    /*
      No donors
    */

    if (
      donors.length === 0
    ) {

      resultsEl.innerHTML = `
        <div class="empty-state">

          <strong>
            No donors found.
          </strong>

          <p>
            Try another filter.
          </p>

        </div>
     
