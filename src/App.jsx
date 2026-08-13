import { useRef, useState, useEffect } from 'react';
import AWS from 'aws-sdk';
import './App.css';

function formatBytes(bytes) {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));

  return (
    (bytes / Math.pow(1024, i)).toFixed(2) +
    ' ' +
    units[i]
  );
}

function safeFolderName(name) {
  return name
    .trim()
    .replace(/[\/\\]/g, '')
    .replace(/\s+/g, '_');
}

function getExternalImageId(residentName, s3Key) {
  const filename = s3Key.split('/').pop();
  return `${residentName}_${filename}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getResidentFromExternalImageId(id) {
  if (!id) return 'Unknown';
  const underscore = id.indexOf('_');
  return underscore !== -1 ? id.slice(0, underscore) : id;
}

export default function App() {
  const s3Ref = useRef(null);
  const rekRef = useRef(null);

  const accessKey = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
  const secretKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';
  const bucket = import.meta.env.VITE_S3_BUCKET;
  const collection = import.meta.env.VITE_REKOGNITION_COLLECTION;

  const [connected, setConnected] = useState(false);

  const [connStatus, setConnStatus] = useState({
    msg: 'Not connected',
    ok: null,
  });

  /*
   * ------------------------------------------------------------
   * NAVIGATION
   * ------------------------------------------------------------
   */

  const [activeSection, setActiveSection] = useState('training');

  const [selectedResident, setSelectedResident] = useState(null);

  /*
   * ------------------------------------------------------------
   * TRAINING DATA
   * ------------------------------------------------------------
   */

  const [residents, setResidents] = useState([]);
  const [residentImages, setResidentImages] = useState([]);

  const [residentLoading, setResidentLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);

  /*
   * ------------------------------------------------------------
   * TEST DATA
   * ------------------------------------------------------------
   */

  const [testObjects, setTestObjects] = useState([]);
  const [testLoading, setTestLoading] = useState(false);

  /*
   * ------------------------------------------------------------
   * ADD USER MODAL
   * ------------------------------------------------------------
   */

  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  /*
   * ------------------------------------------------------------
   * UPLOAD IMAGES
   * ------------------------------------------------------------
   */

  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);

  const uploadInputRef = useRef(null);

  /*
   * ------------------------------------------------------------
   * TRAINING
   * ------------------------------------------------------------
   */

  const [training, setTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState(null);

  /*
   * ------------------------------------------------------------
   * RECOGNITION
   * ------------------------------------------------------------
   */

  const [testFile, setTestFile] = useState(null);
  const [testPreview, setTestPreview] = useState(null);

  const [recLoading, setRecLoading] = useState(false);
  const [recResult, setRecResult] = useState(null);

  const testInputRef = useRef(null);

  /*
   * ------------------------------------------------------------
   * COLLECTION
   * ------------------------------------------------------------
   */

  const [collInfo, setCollInfo] = useState(null);

  /*
   * ------------------------------------------------------------
   * CONNECT
   * ------------------------------------------------------------
   */

  useEffect(() => {
    connectAWS();
  }, []);

  function connectAWS() {
    if (!accessKey || !secretKey) {
      setConnStatus({
        msg: 'AWS credentials are missing.',
        ok: false,
      });

      return;
    }

    try {
      AWS.config.update({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        region,
      });

      s3Ref.current = new AWS.S3({
        apiVersion: '2006-03-01',
        region,
      });

      rekRef.current = new AWS.Rekognition({
        apiVersion: '2016-06-27',
        region,
      });

      setConnected(true);

      setConnStatus({
        msg: 'Connected to AWS successfully.',
        ok: true,
      });

      loadResidents();
      loadTestObjects();
      getCollectionInfo();
    } catch (e) {
      setConnected(false);

      setConnStatus({
        msg: 'Failed to initialize AWS: ' + e.message,
        ok: false,
      });
    }
  }

  function disconnectAWS() {
    AWS.config.update({
      credentials: null,
    });

    s3Ref.current = null;
    rekRef.current = null;

    setConnected(false);
    setResidents([]);
    setResidentImages([]);
    setTestObjects([]);
    setCollInfo(null);

    setConnStatus({
      msg: 'Disconnected.',
      ok: null,
    });
  }

  /*
   * ------------------------------------------------------------
   * LOAD RESIDENT FOLDERS
   *
   * residents/
   *     Atlas/
   *     Zoya/
   *     Lumon/
   * ------------------------------------------------------------
   */

  async function loadResidents() {
    if (!s3Ref.current) return;

    setResidentLoading(true);

    try {
      let allPrefixes = [];
      let token = null;

      do {
        const params = {
          Bucket: bucket,
          Prefix: 'residents/',
          Delimiter: '/',
        };

        if (token) {
          params.ContinuationToken = token;
        }

        const res = await s3Ref.current
          .listObjectsV2(params)
          .promise();

        if (res.CommonPrefixes) {
          allPrefixes = allPrefixes.concat(
            res.CommonPrefixes
          );
        }

        token = res.IsTruncated
          ? res.NextContinuationToken
          : null;
      } while (token);

      const users = allPrefixes
        .map((item) => {
          const prefix = item.Prefix;

          const name = prefix
            .replace('residents/', '')
            .replace(/\/$/, '');

          return {
            name,
            prefix,
          };
        })
        .filter((user) => user.name);

      users.sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      setResidents(users);
    } catch (e) {
      console.error(e);

      setResidents({
        error: e.message,
      });
    } finally {
      setResidentLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * OPEN RESIDENT
   * ------------------------------------------------------------
   */

  async function openResident(resident) {
    setSelectedResident(resident);

    setResidentImages([]);

    setImagesLoading(true);

    try {
      const images =
        await listObjectsByPrefix(
          resident.prefix
        );

      setResidentImages(
        images.filter(
          (obj) =>
            obj.Size > 0 &&
            /\.(jpg|jpeg|png|webp)$/i.test(
              obj.Key
            )
        )
      );
    } catch (e) {
      console.error(e);

      setResidentImages({
        error: e.message,
      });
    } finally {
      setImagesLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * GENERIC PREFIX LIST
   * ------------------------------------------------------------
   */

  async function listObjectsByPrefix(prefix) {
    let all = [];
    let token = null;

    do {
      const params = {
        Bucket: bucket,
        Prefix: prefix,
      };

      if (token) {
        params.ContinuationToken = token;
      }

      const res = await s3Ref.current
        .listObjectsV2(params)
        .promise();

      if (res.Contents) {
        all = all.concat(res.Contents);
      }

      token = res.IsTruncated
        ? res.NextContinuationToken
        : null;
    } while (token);

    return all;
  }

  /*
   * ------------------------------------------------------------
   * CREATE USER / FOLDER
   * ------------------------------------------------------------
   */

  async function createUser() {
    const name = safeFolderName(newUserName);

    if (!name) {
      alert('Please enter a person name.');
      return;
    }

    if (!connected) {
      alert('AWS is not connected.');
      return;
    }

    const exists = residents.some(
      (resident) =>
        resident.name.toLowerCase() ===
        name.toLowerCase()
    );

    if (exists) {
      alert('A user with this name already exists.');
      return;
    }

    setCreatingUser(true);

    try {
      const key = `residents/${name}/`;

      await s3Ref.current
        .putObject({
          Bucket: bucket,
          Key: key,
          Body: '',
        })
        .promise();

      setShowAddUser(false);
      setNewUserName('');

      await loadResidents();

      const newResident = {
        name,
        prefix: key,
      };

      await openResident(newResident);
    } catch (e) {
      alert(
        'Failed to create user: ' +
          e.message
      );
    } finally {
      setCreatingUser(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * SELECT TRAINING IMAGES
   * ------------------------------------------------------------
   */

  function selectTrainingFiles(event) {
    const files = Array.from(
      event.target.files || []
    );

    setUploadFiles(files);

    setUploadStatus(null);
  }

  /*
   * ------------------------------------------------------------
   * UPLOAD TRAINING IMAGES
   * ------------------------------------------------------------
   */

  async function uploadTrainingImages() {
    if (!selectedResident) {
      alert('Select a resident first.');
      return;
    }

    if (!uploadFiles.length) {
      alert('Select at least one image.');
      return;
    }

    setUploadLoading(true);
    setUploadStatus(null);

    try {
      for (const file of uploadFiles) {
        const key =
          `${selectedResident.prefix}${file.name}`;

        await s3Ref.current
          .upload({
            Bucket: bucket,
            Key: key,
            Body: file,
            ContentType: file.type,
          })
          .promise();
      }

      setUploadStatus({
        ok: true,
        msg:
          `${uploadFiles.length} image(s) uploaded successfully.`,
      });

      setUploadFiles([]);

      if (uploadInputRef.current) {
        uploadInputRef.current.value = '';
      }

      await openResident(selectedResident);
    } catch (e) {
      console.error(e);

      setUploadStatus({
        ok: false,
        msg:
          'Upload failed: ' +
          e.message,
      });
    } finally {
      setUploadLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * TRAIN / ENROLL USER
   *
   * Technically:
   *
   * S3 image
   *     ↓
   * IndexFaces
   *     ↓
   * Face collection
   *
   * We use the S3 key as ExternalImageId.
   * ------------------------------------------------------------
   */

  async function trainResident() {
    if (!selectedResident) {
      return;
    }

    if (!residentImages.length) {
      alert(
        'This resident has no training images.'
      );

      return;
    }

    setTraining(true);

    setTrainingStatus({
      ok: null,
      msg: 'Checking indexed faces...',
    });

    try {
      const indexedFaces =
        await getAllIndexedFaces();

      const indexedExternalIds =
        new Set(
          indexedFaces
            .map(
              (face) =>
                face.ExternalImageId
            )
            .filter(Boolean)
        );

      let indexedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      const failures = [];

      for (const image of residentImages) {
        /*
         * If this exact S3 key was already indexed,
         * don't index it again.
         */

        const externalImageId = getExternalImageId(
          selectedResident.name,
          image.Key
        );

        if (indexedExternalIds.has(externalImageId)) {
          skippedCount++;
          continue;
        }

        setTrainingStatus({
          ok: null,
          msg:
            `Training ${image.Key}...`,
        });

        try {
          const result =
            await rekRef.current
              .indexFaces({
                CollectionId:
                  collection,

                Image: {
                  S3Object: {
                    Bucket: bucket,
                    Name: image.Key,
                  },
                },

                ExternalImageId:
                  externalImageId,

                MaxFaces: 1,

                QualityFilter: 'AUTO',

                DetectionAttributes: [
                  'DEFAULT',
                ],
              })
              .promise();

          if (
            result.FaceRecords &&
            result.FaceRecords.length > 0
          ) {
            indexedCount++;

            /*
             * Remember this key for the current
             * training operation.
             */

            indexedExternalIds.add(
              externalImageId
            );
          } else {
            failedCount++;

            failures.push({
              image: image.Key,
              reason:
                'No suitable face was indexed.',
            });
          }
        } catch (e) {
          failedCount++;

          failures.push({
            image: image.Key,
            reason: e.message,
          });
        }
      }

      let message =
        `Training completed. ` +
        `${indexedCount} indexed, ` +
        `${skippedCount} already indexed`;

      if (failedCount > 0) {
        message +=
          `, ${failedCount} failed.`;
      } else {
        message += '.';
      }

      setTrainingStatus({
        ok: failedCount === 0,
        msg: message,
        failures,
      });

      await getCollectionInfo();
    } catch (e) {
      console.error(e);

      setTrainingStatus({
        ok: false,
        msg:
          'Training failed: ' +
          e.message,
      });
    } finally {
      setTraining(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * GET ALL INDEXED FACES
   * ------------------------------------------------------------
   */

  async function getAllIndexedFaces() {
    let faces = [];
    let token = null;

    do {
      const params = {
        CollectionId: collection,
        MaxResults: 1000,
      };

      if (token) {
        params.NextToken = token;
      }

      const res =
        await rekRef.current
          .listFaces(params)
          .promise();

      if (res.Faces) {
        faces = faces.concat(
          res.Faces
        );
      }

      token = res.NextToken || null;
    } while (token);

    return faces;
  }

  /*
   * ------------------------------------------------------------
   * TEST DATA
   * ------------------------------------------------------------
   */

  async function loadTestObjects() {
    if (!s3Ref.current) return;

    setTestLoading(true);

    try {
      const objects =
        await listObjectsByPrefix(
          'tests/'
        );

      setTestObjects(
        objects.filter(
          (obj) =>
            obj.Size > 0 &&
            /\.(jpg|jpeg|png|webp)$/i.test(
              obj.Key
            )
        )
      );
    } catch (e) {
      console.error(e);

      setTestObjects({
        error: e.message,
      });
    } finally {
      setTestLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * VIEW OBJECT
   * ------------------------------------------------------------
   */

  function viewObject(key) {
    try {
      const url =
        s3Ref.current.getSignedUrl(
          'getObject',
          {
            Bucket: bucket,
            Key: key,
            Expires: 300,
          }
        );

      window.open(
        url,
        '_blank'
      );
    } catch (e) {
      alert(
        'Unable to generate URL: ' +
          e.message
      );
    }
  }

  /*
   * ------------------------------------------------------------
   * TEST S3 OBJECT
   * ------------------------------------------------------------
   */

  async function testS3Object(key) {
    if (!connected) {
      alert('Connect to AWS first.');
      return;
    }

    setRecLoading(true);
    setRecResult(null);

    try {
      const res =
        await rekRef.current
          .searchFacesByImage({
            CollectionId:
              collection,

            Image: {
              S3Object: {
                Bucket: bucket,
                Name: key,
              },
            },

            FaceMatchThreshold: 80,

            MaxFaces: 5,

            QualityFilter: 'AUTO',
          })
          .promise();

      setRecResult({
        type: 'response',
        data: res,
        key,
      });
    } catch (e) {
      setRecResult({
        type: 'error',
        msg: e.message,
      });
    } finally {
      setRecLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * TEST LOCAL IMAGE
   * ------------------------------------------------------------
   */

  function selectTestFile(event) {
    const file =
      event.target.files[0] || null;

    setTestFile(file);

    setTestPreview(
      file
        ? URL.createObjectURL(file)
        : null
    );
  }

  async function recognizeFace() {
    if (!connected) {
      alert('Connect to AWS first.');
      return;
    }

    if (!testFile) {
      alert(
        'Please select a test image first.'
      );

      return;
    }

    setRecLoading(true);
    setRecResult(null);

    try {
      const safeName =
        Date.now() +
        '_' +
        testFile.name.replace(
          /[^a-zA-Z0-9._-]/g,
          '_'
        );

      const key =
        'tests/' + safeName;

      await s3Ref.current
        .upload({
          Bucket: bucket,
          Key: key,
          Body: testFile,
          ContentType: testFile.type,
        })
        .promise();

      const res =
        await rekRef.current
          .searchFacesByImage({
            CollectionId:
              collection,

            Image: {
              S3Object: {
                Bucket: bucket,
                Name: key,
              },
            },

            FaceMatchThreshold: 80,

            MaxFaces: 5,

            QualityFilter: 'AUTO',
          })
          .promise();

      setRecResult({
        type: 'response',
        data: res,
        key,
      });

      await loadTestObjects();
    } catch (e) {
      setRecResult({
        type: 'error',
        msg: e.message,
      });
    } finally {
      setRecLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * COLLECTION INFO
   * ------------------------------------------------------------
   */

  async function getCollectionInfo() {
    if (!rekRef.current) return;

    try {
      const res =
        await rekRef.current
          .describeCollection({
            CollectionId:
              collection,
          })
          .promise();

      setCollInfo({
        ok: true,
        data: res,
      });
    } catch (e) {
      setCollInfo({
        ok: false,
        msg: e.message,
      });
    }
  }

  /*
   * ------------------------------------------------------------
   * RECOGNITION RESULT
   * ------------------------------------------------------------
   */

  function RecognitionResult() {
    if (!recResult) return null;

    if (
      recResult.type === 'error'
    ) {
      return (
        <div className="result">
          <div className="unknown">
            <strong>
              Recognition Failed
            </strong>

            <br />
            <br />

            {recResult.msg}
          </div>
        </div>
      );
    }

    const {
      data,
      key,
    } = recResult;

    if (
      !data.FaceMatches ||
      data.FaceMatches.length === 0
    ) {
      return (
        <div className="result">
          <div className="unknown">
            <h3>
              UNKNOWN PERSON
            </h3>

            <p>
              No matching resident
              was found.
            </p>

            <p className="muted small">
              Source: {key}
            </p>
          </div>
        </div>
      );
    }

    const best =
      data.FaceMatches[0];

    const face =
      best.Face;

    const residentName =
      getResidentFromExternalImageId(
        face.ExternalImageId
      );

    return (
      <div className="result">
        <div className="known">

          <h3>
            KNOWN PERSON
          </h3>

          <p>
            <strong>
              Resident:
            </strong>{' '}
            {residentName}
          </p>

          <p>
            <strong>
              Similarity:
            </strong>{' '}
            {best.Similarity.toFixed(
              2
            )}
            %
          </p>

          <p>
            <strong>
              Face Confidence:
            </strong>{' '}
            {face.Confidence
              ? face.Confidence.toFixed(
                  2
                )
              : 'N/A'}
            %
          </p>

          <p>
            <strong>
              Face ID:
            </strong>{' '}
            <span className="small">
              {face.FaceId}
            </span>
          </p>

          <p className="muted small">
            Source: {key}
          </p>

        </div>

        {data.FaceMatches.length >
          1 && (
          <>
            <br />

            <strong>
              Other Matches
            </strong>

            {data.FaceMatches
              .slice(1)
              .map(
                (match, index) => (
                  <div
                    key={index}
                    className="match-item"
                  >
                    <strong>
                      {
                        getResidentFromExternalImageId(
                          match.Face
                            .ExternalImageId
                        )
                      }
                    </strong>

                    <br />

                    Similarity:{' '}
                    {match.Similarity.toFixed(
                      2
                    )}
                    %
                  </div>
                )
              )}
          </>
        )}
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------
   */

  return (
    <>
      <header>
        <h1>
          Face Recognition
        </h1>

        <p>
          {/* Amazon S3 + Amazon Rekognition */}
          {/* Face Collection */}
        </p>
      </header>

      <div className="container">

        {/* CONNECTION */}

        {/* <div className="card config-card">

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span
              className={
                connStatus.ok === true
                  ? 'success'
                  : 'error'
              }
            >
              {connStatus.ok === true
                ? '● Connected to AWS'
                : '● Not connected'}
            </span>

            {connStatus.ok !==
              true && (
              <button
                className="primary"
                onClick={
                  connectAWS
                }
              >
                Retry
              </button>
            )}

            {connStatus.ok ===
              true && (
              <button
                className="secondary"
                onClick={
                  disconnectAWS
                }
              >
                Disconnect
              </button>
            )}

            {connStatus.ok ===
              false && (
              <span className="error small">
                {connStatus.msg}
              </span>
            )}
          </div>

        </div> */}


        {/* MAIN NAVIGATION */}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              '1fr 1fr',
            gap: 20,
            marginBottom: 20,
          }}
        >

          <button
            onClick={() =>
              setActiveSection(
                'training'
              )
            }
            style={{
              padding: 28,
              background:
                activeSection ===
                'training'
                  ? '#2563eb'
                  : '#111720',
              border:
                '1px solid #27313d',
              borderRadius: 12,
              textAlign: 'left',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Training Data
            </div>

            <div
              style={{
                color:
                  activeSection ===
                  'training'
                    ? '#dbeafe'
                    : '#8c98a6',
              }}
            >
              Residents and their
              training images
            </div>

            <div
              style={{
                marginTop: 15,
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {residents.length}
            </div>

            <div
              className="small"
              style={{
                opacity: 0.8,
              }}
            >
              Residents
            </div>
          </button>


          <button
            onClick={() =>
              setActiveSection(
                'test'
              )
            }
            style={{
              padding: 28,
              background:
                activeSection ===
                'test'
                  ? '#2563eb'
                  : '#111720',
              border:
                '1px solid #27313d',
              borderRadius: 12,
              textAlign: 'left',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Test Data
            </div>

            <div
              style={{
                color:
                  activeSection ===
                  'test'
                    ? '#dbeafe'
                    : '#8c98a6',
              }}
            >
              Images used for recognition
              testing
            </div>

            <div
              style={{
                marginTop: 15,
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {testObjects.length}
            </div>

            <div
              className="small"
              style={{
                opacity: 0.8,
              }}
            >
              Test images
            </div>
          </button>

        </div>


        {/* =====================================================
            TRAINING DATA
            ===================================================== */}
{/* =====================================================
    QUICK RANDOM IMAGE TEST
    ===================================================== */}

{/* <div className="card hidden" style={{ marginBottom: 20 }}>

  <h2>Test Random Image</h2>

  <p className="section-description">
    Upload any image and check whether the person
    is recognized against the current Rekognition
    face collection.
  </p>

  <div
    className="upload-area"
    onClick={() =>
      testInputRef.current?.click()
    }
  >
    <strong>
      Click to select an image
    </strong>

    <div className="file-name">
      {testFile
        ? `${testFile.name} (${formatBytes(
            testFile.size
          )})`
        : 'No image selected'}
    </div>

    <input
      ref={testInputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      style={{ display: 'none' }}
      onChange={selectTestFile}
    />
  </div>

  {testPreview && (
    <div style={{ marginTop: 20 }}>
      <img
        src={testPreview}
        alt="Test"
        style={{
          width: '100%',
          maxWidth: 500,
          maxHeight: 400,
          objectFit: 'contain',
          borderRadius: 10,
          border: '1px solid #27313d',
        }}
      />
    </div>
  )}

  <div
    style={{
      display: 'flex',
      gap: 10,
      marginTop: 20,
      flexWrap: 'wrap',
    }}
  >
    <button
      className="primary"
      disabled={
        recLoading ||
        !testFile ||
        !connected
      }
      onClick={recognizeFace}
    >
      {recLoading
        ? 'Recognizing...'
        : 'Recognize Person'}
    </button>

    {testFile && (
      <button
        className="secondary"
        onClick={() => {
          setTestFile(null);
          setTestPreview(null);
          setRecResult(null);

          if (testInputRef.current) {
            testInputRef.current.value = '';
          }
        }}
      >
        Clear
      </button>
    )}
  </div>

  <RecognitionResult />

</div> */}
        {activeSection ===
          'training' && (
          <div className="card">

            {!selectedResident ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent:
                      'space-between',
                    alignItems: 'center',
                    gap: 15,
                    marginBottom: 20,
                  }}
                >

                  <div>
                    <h2>
                      Residents
                    </h2>

                    <p className="section-description">
                      Select a resident to
                      view and manage training
                      images.
                    </p>
                  </div>

                  <button
                    className="primary"
                    onClick={() =>
                      setShowAddUser(
                        true
                      )
                    }
                  >
                    + Add User
                  </button>

                </div>


                {residentLoading && (
                  <div className="loader">
                    Loading residents...
                  </div>
                )}


                {residents?.error && (
                  <div className="error">
                    {residents.error}
                  </div>
                )}


                {!residentLoading &&
                  Array.isArray(
                    residents
                  ) &&
                  residents.length ===
                    0 && (
                    <div
                      className="status"
                      style={{
                        textAlign:
                          'center',
                        padding: 40,
                      }}
                    >
                      <h3>
                        No residents yet
                      </h3>

                      <p className="muted">
                        Add your first
                        resident to begin
                        training.
                      </p>

                      <button
                        className="primary"
                        onClick={() =>
                          setShowAddUser(
                            true
                          )
                        }
                      >
                        + Add User
                      </button>
                    </div>
                  )}


                {Array.isArray(
                  residents
                ) && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(auto-fill, minmax(230px, 1fr))',
                      gap: 15,
                    }}
                  >
                    {residents.map(
                      (resident) => (
                        <button
                          key={
                            resident.prefix
                          }
                          onClick={() =>
                            openResident(
                              resident
                            )
                          }
                          style={{
                            background:
                              '#0b0f14',
                            border:
                              '1px solid #27313d',
                            borderRadius: 10,
                            padding: 22,
                            textAlign:
                              'left',
                            color:
                              'white',
                            cursor:
                              'pointer',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 18,
                              fontWeight:
                                700,
                              marginBottom:
                                8,
                            }}
                          >
                            👤{' '}
                            {
                              resident.name
                            }
                          </div>

                          <div className="muted small">
                            {
                              resident.prefix
                            }
                          </div>

                          <div
                            style={{
                              marginTop:
                                15,
                              color:
                                '#60a5fa',
                              fontSize:
                                13,
                            }}
                          >
                            Open resident →
                          </div>
                        </button>
                      )
                    )}

                    <button
                      onClick={() =>
                        setShowAddUser(
                          true
                        )
                      }
                      style={{
                        background:
                          'transparent',
                        border:
                          '2px dashed #303a46',
                        borderRadius:
                          10,
                        padding: 22,
                        color:
                          '#8c98a6',
                        cursor:
                          'pointer',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 30,
                        }}
                      >
                        +
                      </div>

                      <div>
                        Add User
                      </div>
                    </button>

                  </div>
                )}
              </>
            ) : (

              /*
               * RESIDENT DETAIL
               */

              <>
                <div
                  style={{
                    display:
                      'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'center',
                    gap: 15,
                    flexWrap:
                      'wrap',
                    marginBottom:
                      20,
                  }}
                >

                  <div>

                    <button
                      className="secondary"
                      onClick={() =>
                        setSelectedResident(
                          null
                        )
                      }
                      style={{
                        marginBottom:
                          12,
                      }}
                    >
                      ← Back
                    </button>

                    <h2>
                      {
                        selectedResident.name
                      }
                    </h2>

                    <p className="section-description">
                      {
                        selectedResident.prefix
                      }
                    </p>

                  </div>


                  <div
                    style={{
                      display:
                        'flex',
                      gap: 10,
                      flexWrap:
                        'wrap',
                    }}
                  >

                    <button
                      className="secondary"
                      onClick={() =>
                        uploadInputRef.current?.click()
                      }
                    >
                      + Add Images
                    </button>

                    <button
                      className="primary"
                      disabled={
                        training ||
                        !residentImages.length
                      }
                      onClick={
                        trainResident
                      }
                    >
                      {training
                        ? 'Training...'
                        : 'Train / Enroll'}
                    </button>

                  </div>

                </div>


                <input
                  ref={
                    uploadInputRef
                  }
                  type="file"
                  accept="image/*"
                  multiple
                  style={{
                    display:
                      'none',
                  }}
                  onChange={
                    selectTrainingFiles
                  }
                />


                {uploadFiles.length >
                  0 && (
                  <div
                    className="status"
                    style={{
                      marginBottom:
                        15,
                    }}
                  >

                    <strong>
                      {
                        uploadFiles.length
                      }{' '}
                      image(s) selected
                    </strong>

                    <br />

                    <div
                      className="small muted"
                      style={{
                        marginTop:
                          8,
                      }}
                    >
                      {uploadFiles
                        .map(
                          (f) =>
                            f.name
                        )
                        .join(
                          ', '
                        )}
                    </div>

                    <br />

                    <button
                      className="primary"
                      disabled={
                        uploadLoading
                      }
                      onClick={
                        uploadTrainingImages
                      }
                    >
                      {uploadLoading
                        ? 'Uploading...'
                        : 'Upload Images'}
                    </button>

                  </div>
                )}


                {uploadStatus && (
                  <div
                    className={`status ${
                      uploadStatus.ok
                        ? 'success'
                        : 'error'
                    }`}
                  >
                    {
                      uploadStatus.msg
                    }
                  </div>
                )}


                {trainingStatus && (
                  <div
                    className={`status ${
                      trainingStatus.ok ===
                      true
                        ? 'success'
                        : trainingStatus.ok ===
                          false
                        ? 'error'
                        : ''
                    }`}
                    style={{
                      marginTop: 15,
                    }}
                  >
                    {
                      trainingStatus.msg
                    }

                    {trainingStatus
                      .failures
                      ?.length >
                      0 && (
                      <div
                        style={{
                          marginTop:
                            10,
                        }}
                      >
                        {trainingStatus.failures.map(
                          (
                            failure,
                            index
                          ) => (
                            <div
                              key={
                                index
                              }
                              className="small"
                              style={{
                                marginTop:
                                  5,
                              }}
                            >
                              {failure.image}
                              {' — '}
                              {
                                failure.reason
                              }
                            </div>
                          )
                        )}
                      </div>
                    )}

                  </div>
                )}


                <div
                  style={{
                    display:
                      'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'center',
                    marginTop:
                      25,
                    marginBottom:
                      10,
                  }}
                >

                  <h3
                    style={{
                      margin: 0,
                    }}
                  >
                    Training Images
                  </h3>

                  <span className="muted small">
                    {
                      residentImages.length
                    }{' '}
                    image(s)
                  </span>

                </div>


                {imagesLoading && (
                  <div className="loader">
                    Loading images...
                  </div>
                )}


                {residentImages?.error && (
                  <div className="error">
                    {
                      residentImages.error
                    }
                  </div>
                )}


                {!imagesLoading &&
                  Array.isArray(
                    residentImages
                  ) &&
                  residentImages.length ===
                    0 && (
                    <div className="status">
                      No training images yet.
                      Click{' '}
                      <strong>
                        Add Images
                      </strong>{' '}
                      to upload them.
                    </div>
                  )}


                {Array.isArray(
                  residentImages
                ) && (
                  <div
                    style={{
                      display:
                        'grid',
                      gridTemplateColumns:
                        'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: 15,
                    }}
                  >

                    {residentImages.map(
                      (image) => (
                        <div
                          key={
                            image.Key
                          }
                          style={{
                            background:
                              '#0b0f14',
                            border:
                              '1px solid #27313d',
                            borderRadius:
                              10,
                            overflow:
                              'hidden',
                          }}
                        >

                          <img
                            src={s3Ref.current?.getSignedUrl(
                              'getObject',
                              {
                                Bucket:
                                  bucket,
                                Key:
                                  image.Key,
                                Expires:
                                  300,
                              }
                            )}
                            alt={
                              image.Key
                            }
                            style={{
                              width:
                                '100%',
                              height:
                                180,
                              objectFit:
                                'cover',
                              display:
                                'block',
                            }}
                          />

                          <div
                            style={{
                              padding:
                                12,
                            }}
                          >

                            <div
                              style={{
                                fontSize:
                                  13,
                                fontWeight:
                                  600,
                                wordBreak:
                                  'break-all',
                              }}
                            >
                              {
                                image.Key.split(
                                  '/'
                                ).pop()
                              }
                            </div>

                            <div className="muted small">
                              {formatBytes(
                                image.Size
                              )}
                            </div>

                            <button
                              className="secondary"
                              style={{
                                marginTop:
                                  10,
                                width:
                                  '100%',
                              }}
                              onClick={() =>
                                viewObject(
                                  image.Key
                                )
                              }
                            >
                              View
                            </button>

                          </div>

                        </div>
                      )
                    )}

                  </div>
                )}

              </>
            )}

          </div>
        )}


        {/* =====================================================
            TEST DATA
            ===================================================== */}

        {activeSection ===
          'test' && (
          <div className="grid">

            {/* TEST UPLOAD */}

            <div className="card">

              <h2>
                Test Recognition
              </h2>

              <p className="section-description">
                Upload a test image and
                search it against the
                resident face collection.
              </p>

              <div
                className="upload-area"
                onClick={() =>
                  testInputRef.current?.click()
                }
              >

                <strong>
                  Click to select test image
                </strong>

                <div className="file-name">
                  {testFile
                    ? `${testFile.name} (${formatBytes(
                        testFile.size
                      )})`
                    : 'No file selected'}
                </div>

                <input
                  ref={
                    testInputRef
                  }
                  type="file"
                  accept="image/*"
                  style={{
                    display:
                      'none',
                  }}
                  onChange={
                    selectTestFile
                  }
                />

              </div>


              {testPreview && (
                <img
                  src={
                    testPreview
                  }
                  className="preview"
                  alt="Test"
                />
              )}


              <br />

              <button
                className="primary"
                disabled={
                  recLoading ||
                  !testFile
                }
                onClick={
                  recognizeFace
                }
              >
                {recLoading
                  ? 'Searching...'
                  : 'Search Face'}
              </button>

              <RecognitionResult />

            </div>


            {/* TEST OBJECTS */}

            <div className="card">

              <div
                style={{
                  display:
                    'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'center',
                }}
              >

                <div>

                  <h2>
                    Test Data
                  </h2>

                  <p className="section-description">
                    Existing test images
                  </p>

                </div>

                <button
                  className="secondary"
                  onClick={
                    loadTestObjects
                  }
                >
                  Refresh
                </button>

              </div>


              {testLoading && (
                <div className="loader">
                  Loading test data...
                </div>
              )}


              {Array.isArray(
                testObjects
              ) &&
                testObjects.map(
                  (obj) => (
                    <div
                      key={
                        obj.Key
                      }
                      className="object"
                    >

                      <div className="object-name">

                        <strong>
                          {
                            obj.Key.split(
                              '/'
                            ).pop()
                          }
                        </strong>

                        <br />

                        <span className="muted small">
                          {formatBytes(
                            obj.Size
                          )}
                        </span>

                      </div>


                      <div className="object-actions">

                        <button
                          className="secondary"
                          onClick={() =>
                            viewObject(
                              obj.Key
                            )
                          }
                        >
                          View
                        </button>

                        <button
                          className="primary"
                          onClick={() =>
                            testS3Object(
                              obj.Key
                            )
                          }
                        >
                          Test
                        </button>

                      </div>

                    </div>
                  )
                )}

            </div>

          </div>
        )}


        {/* =====================================================
            COLLECTION INFO
            ===================================================== */}

        <div
          className="card"
          style={{
            marginTop: 20,
          }}
        >

          <div
            style={{
              display:
                'flex',
              justifyContent:
                'space-between',
              alignItems:
                'center',
              gap: 15,
            }}
          >

            <div>

              <h2>
                Rekognition Collection
              </h2>

              <p className="section-description">
                {
                  collection
                }
              </p>

            </div>

            <button
              className="secondary"
              onClick={
                getCollectionInfo
              }
            >
              Refresh
            </button>

          </div>


          {collInfo && (
            <div
              className={`status ${
                collInfo.ok
                  ? 'success'
                  : 'error'
              }`}
            >

              {collInfo.ok ? (
                <>
                  <strong>
                    Collection:
                  </strong>{' '}
                  {
                    collection
                  }

                  <br />

                  <strong>
                    Face Count:
                  </strong>{' '}
                  {
                    collInfo.data
                      .FaceCount
                  }

                  <br />

                  <strong>
                    User Count:
                  </strong>{' '}
                  {
                    collInfo.data
                      .UserCount
                  }

                  <br />

                  <strong>
                    Face Model:
                  </strong>{' '}
                  {
                    collInfo.data
                      .FaceModelVersion
                  }
                </>
              ) : (
                'Unable to read collection: ' +
                collInfo.msg
              )}

            </div>
          )}

        </div>

      </div>


      {/* =======================================================
          ADD USER MODAL
          ======================================================= */}

      {showAddUser && (
        <div
          style={{
            position:
              'fixed',
            inset: 0,
            background:
              'rgba(0,0,0,0.7)',
            display:
              'flex',
            alignItems:
              'center',
            justifyContent:
              'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() =>
            setShowAddUser(
              false
            )
          }
        >

          <div
            className="card"
            style={{
              width:
                '100%',
              maxWidth:
                500,
            }}
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <h2>
              Add Resident
            </h2>

            <p className="section-description">
              Create a new resident
              training folder.
            </p>

            <label>
              Person Name
            </label>

            <input
              autoFocus
              type="text"
              value={
                newUserName
              }
              placeholder="e.g. Rahul Sharma"
              onChange={(e) =>
                setNewUserName(
                  e.target.value
                )
              }
              onKeyDown={(e) => {
                if (
                  e.key ===
                  'Enter'
                ) {
                  createUser();
                }
              }}
            />

            <div
              className="muted small"
              style={{
                marginTop:
                  10,
              }}
            >
              S3 folder:

              <br />

              residents/
              {safeFolderName(
                newUserName
              ) || 'PersonName'}
              /
            </div>

            <br />

            <div
              style={{
                display:
                  'flex',
                justifyContent:
                  'flex-end',
                gap: 10,
              }}
            >

              <button
                className="secondary"
                onClick={() =>
                  setShowAddUser(
                    false
                  )
                }
              >
                Cancel
              </button>

              <button
                className="primary"
                disabled={
                  creatingUser
                }
                onClick={
                  createUser
                }
              >
                {creatingUser
                  ? 'Creating...'
                  : 'Create User'}
              </button>

            </div>

          </div>

        </div>
      )}

    </>
  );
}