/* =========================================================
   BADHAN ZH - Public Blood Donor Directory
   ========================================================= */

(() => {
  "use strict";


  /* =========================================================
     DOM ELEMENTS
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
     HTML SAFETY
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
     NORMALIZE TEXT
     
     Makes these equivalent:
     
     Zahurul Huq Hall
     zahurul huq hall
     ZAHURUL HUQ HALL
     ZaHuRuL HuQ HaLl
     
     Also removes extra spaces / NBSP.
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


  /* =========================================================
     DATE PARSER
     ========================================================= */

  function parseDate(value) {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      const copy = new Date(value);

      return Number.isNaN(copy.getTime())
        ? null
        : copy;
    }

    const raw = String(value).trim();

    /*
      Supabase DATE:
      YYYY-MM-DD
    */

    const iso = raw.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})/
    );

    if (iso) {
      const d = new Date(
        Date.UTC(
          Number(iso[1]),
          Number(iso[2]) - 1,
          Number(iso[3])
        )
      );

      return Number.isNaN(d.getTime())
        ? null
        : d;
    }


    /*
      MM/DD/YYYY
    */

    const slash = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

    if (slash) {
      const d = new Date(
        Date.UTC(
          Number(slash[3]),
          Number(slash[1]) - 1,
          Number(slash[2])
        )
      );

      return Number.isNaN(d.getTime())
        ? null
        : d;
    }


    /*
      Fallback
    */

    const d = new Date(raw);

    return Number.isNaN(d.getTime())
      ? null
      : d;
  }


  /* =========================================================
     FORMAT DATE
     ========================================================= */

  function formatDate(value) {
    const d = parseDate(value);

    if (!d) {
      return "Not specified";
    }

    return d.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
      }
    );
  }


  /* =========================================================
     TODAY - UTC DATE
     ========================================================= */

  function today() {
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
     ELIGIBILITY DATE
     
     Blood donor becomes available 3 months after
     last donation.
     ========================================================= */

  function eligibilityDate(lastDonation) {
    const d = parseDate(lastDonation);

    if (!d) {
      return null;
    }

    return new Date(
      Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth() + 3,
        d.getUTCDate()
      )
    );
  }


  /* =========================================================
     AVAILABILITY LOGIC
     
     RULE:
     
     1. If last_donation exists:
        calculate 3 months automatically.
     
     2. If 3 months have passed:
        AVAILABLE
     
     3. If 3 months have NOT passed:
        UNAVAILABLE
     
     4. If last_donation does not exist:
        use database "available" field.
     ========================================================= */

  function effectiveAvailable(donor) {

    const lastDonation =
      donor.last_donation;


    /*
      Last donation is the primary source.
    */

    if (lastDonation) {

      const eligible =
        eligibilityDate(lastDonation);

      if (eligible) {

        return (
          eligible.getTime() <=
          today().getTime()
        );

      }
    }


    /*
      If no valid last donation exists,
      use database availability.
    */

    return (
      donor.available === true ||
      donor.available === "true" ||
      donor.available === 1 ||
      donor.available === "1"
    );
  }


  /* =========================================================
     AVAILABLE FROM DATE
     ========================================================= */

  function effectiveAvailableDate(donor) {

    /*
      If last donation exists,
      available date = last donation + 3 months.
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
      Otherwise use available_from.
    */

    if (donor.available_from) {

      return parseDate(
        donor.available_from
      );
    }


    return null;
  }


  /* =========================================================
     SUPABASE CONFIG
     ========================================================= */

  function getConfigValue(names) {

    for (const name of names) {

      if (
        typeof window[name] !== "undefined" &&
        window[name]
      ) {
        return window[name];
      }

    }

    return "";
  }


  /* =========================================================
     CREATE SUPABASE CLIENT
     ========================================================= */

  function createClient() {

    if (
      !window.supabase ||
      typeof window.supabase.createClient !== "function"
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
     SUPABASE VARIABLES
     ========================================================= */

  let supabaseClient = null;

  let allDonors = [];


  /* =========================================================
     LOAD DONORS
     
     IMPORTANT:
     We DO NOT call populateCities().
     
     City dropdown is already written inside index.html.
     ========================================================= */

  async function loadDonors() {

    try {

      if (!supabaseClient) {

        supabaseClient =
          createClient();

      }


      const {
        data,
        error
      } = await supabaseClient
        .from("donors")
        .select("*");


      if (error) {
        throw error;
      }


      allDonors =
        Array.isArray(data)
          ? data
          : [];


      /*
        Render immediately.
      */

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
              Please refresh the page and try again.
            </p>
          </div>
        `;

      }

    }
  }


  /* =========================================================
     FILTER DONORS
     ========================================================= */

  function filteredDonors() {

    /*
      Read current filter values.
    */

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


    /*
      Filter donor data.
    */

    const list =
      allDonors.filter(
        (donor) => {

          /*
            -----------------------------------------------
            BLOOD GROUP
            -----------------------------------------------
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
            -----------------------------------------------
            CITY / DISTRICT
            -----------------------------------------------
            
            Example:
            
            Filter:
            Dhaka
            
            Donor:
            Dhaka
            
            -> MATCH
          */

          const donorCity =
            normalize(
              donor.city
            );


          if (
            city &&
            donorCity !== city
          ) {

            return false;

          }


          /*
            -----------------------------------------------
            SPECIFIC LOCATION
            -----------------------------------------------
            
            Case-insensitive.
            
            Example:
            
            Zahurul Huq Hall
            zahurul huq hall
            ZAHURUL HUQ HALL
            
            all match.
          */

          const donorLocation =
            normalize(
              donor.location
            );


          if (
            location &&
            !donorLocation.includes(
              location
            )
          ) {

            return false;

          }


          /*
            -----------------------------------------------
            AVAILABILITY
            -----------------------------------------------
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
            -> no availability filter
          */


          return true;

        }
      );


    /* =====================================================
       SORT
       ===================================================== */

    const sort =
      sortEl?.value ||
      "available";


    /*
      AVAILABLE FIRST
    */

    if (sort === "available") {

      list.sort(
        (a, b) => {

          const av =
            effectiveAvailable(a)
              ? 0
              : 1;

          const bv =
            effectiveAvailable(b)
              ? 0
              : 1;


          if (av !== bv) {

            return av - bv;

          }


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

    else if (sort === "blood") {

      list.sort(
        (a, b) => {

          return normalize(
            a.blood_group ??
            a.blood
          ).localeCompare(
            normalize(
              b.blood_group ??
              b.blood
            )
          );

        }
      );

    }


    /*
      LOCATION
    */

    else if (sort === "location") {

      list.sort(
        (a, b) => {

          const al =
            `${a.city ?? ""} ${
              a.location ?? ""
            }`;

          const bl =
            `${b.city ?? ""} ${
              b.location ?? ""
            }`;


          return al.localeCompare(
            bl
          );

        }
      );

    }


    /*
      RECENTLY VERIFIED
    */

    else if (sort === "recent") {

      list.sort(
        (a, b) => {

          const ad =
            parseDate(
              a.verified_at
            )?.getTime() || 0;

          const bd =
            parseDate(
              b.verified_at
            )?.getTime() || 0;


          return bd - ad;

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


    /*
      Calculate current availability.
    */

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


    /*
      Dates
    */

    const lastDonation =
      formatDate(
        donor.last_donation
      );


    const availableFrom =
      formatDate(
        effectiveAvailableDate(
          donor
        )
      );


    const verified =
      formatDate(
        donor.verified_at
      );


    /*
      Phone
    */

    const phone =
      String(
        donor.phone ?? ""
      ).trim();


    let contactButton;


    if (phone) {

      contactButton = `
        <a
          class="contact-btn"
          href="tel:${escapeHtml(phone)}"
        >
          Contact donor
        </a>
      `;

    } else {

      contactButton = `
        <button
          class="contact-btn"
          type="button"
          disabled
        >
          Contact donor
        </button>
      `;

    }


    /*
      Return donor card.
    */

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


        <span class="status ${statusClass}">
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
      Update count.
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
      No results.
    */

    if (!donors.length) {

      resultsEl.innerHTML = `
        <div class="empty-state">

          <strong>
            No donors found.
          </strong>

          <p>
            Try another blood group,
            location, or availability filter.
          </p>

        </div>
      `;

      return;
    }


    /*
      Display donor cards.
    */

    resultsEl.innerHTML =
      donors
        .map(
          donorCard
        )
        .join("");
  }


  /* =========================================================
     FILTER EVENTS
     ========================================================= */

  [
    bloodEl,
    cityEl,
    locationEl,
    statusEl,
    sortEl

  ].forEach(
    (element) => {

      if (!element) {
        return;
      }


      /*
        Select boxes
      */

      element.addEventListener(
        "change",
        render
      );


      /*
        Text input
      */

      element.addEventListener(
        "input",
        render
      );

    }
  );


  /* =========================================================
     INITIAL LOAD
     ========================================================= */

  loadDonors();

})();
